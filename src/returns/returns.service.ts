import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BLOCKING_BOOKING_STATUSES } from '../borrowings/borrowings.constants';
import { BorrowRequest } from '../borrowings/entities/borrow-request.entity';
import { ItemBooking } from '../borrowings/entities/item-booking.entity';
import {
  AvailabilityStatus,
  BorrowRequestStatus,
  BookingStatus,
  ItemCondition,
  RepairStatus,
} from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';
import { RepairRecord } from '../repairs/entities/repair-record.entity';
import { HandoverItem } from '../handovers/entities/handover-item.entity';
import { HandoverRecord } from '../handovers/entities/handover-record.entity';
import { CreateReturnDto, ReturnItemDto } from './dto/create-return.dto';
import { ReturnResponseDto } from './dto/return-response.dto';
import { ReturnItem } from './entities/return-item.entity';
import { ReturnRecord } from './entities/return-record.entity';

/**
 * Return barang per unit oleh Sapras.
 *
 * Aturan:
 *  - Request harus sudah HANDED_OVER dan memiliki handover.
 *  - Return hanya sekali per request (return_records UNIQUE request_id) dan
 *    harus mencakup seluruh barang per unit dari handover tersebut.
 *  - return_item.handover_item_id wajib milik handover request yang sama.
 *  - Konsumsi tidak dikembalikan (hanya barang PER_UNIT).
 *  - Kondisi menentukan status unit:
 *      LAYAK_PAKAI      -> AVAILABLE
 *      PERLU_DIPERBAIKI -> REPAIR + repair_records
 *      RUSAK_TOTAL      -> UNAVAILABLE
 *  - Setelah return, booking terkait menjadi COMPLETED dan request RETURNED.
 */
@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(private readonly dataSource: DataSource) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateReturnDto,
  ): Promise<ReturnResponseDto> {
    const returnId = await this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(BorrowRequest, {
        where: { id: dto.requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request) {
        throw new NotFoundException('Request peminjaman tidak ditemukan');
      }

      const existing = await manager.findOne(ReturnRecord, {
        where: { requestId: request.id },
      });
      if (existing) {
        throw new ConflictException({
          message: 'Return untuk request ini sudah tercatat',
          code: 'RETURN_EXISTS',
        });
      }

      if (request.status !== BorrowRequestStatus.HANDED_OVER) {
        throw new ConflictException({
          message: `Request berstatus ${request.status} dan tidak dapat dikembalikan`,
          code: 'INVALID_STATUS',
        });
      }

      const handover = await manager.findOne(HandoverRecord, {
        where: { requestId: request.id },
      });
      if (!handover) {
        throw new ConflictException({
          message: 'Request belum memiliki handover sehingga tidak dapat dikembalikan',
          code: 'HANDOVER_NOT_FOUND',
        });
      }

      const handoverItems = await manager.find(HandoverItem, {
        where: { handoverId: handover.id },
      });
      const returnable = handoverItems.filter(
        (item) => item.inventoryUnitId !== null,
      );
      if (!returnable.length) {
        throw new BadRequestException({
          message:
            'Request ini tidak memiliki barang per unit yang dapat dikembalikan (barang habis pakai tidak dikembalikan)',
          code: 'NOTHING_TO_RETURN',
        });
      }

      // Duplikasi di dalam payload.
      const payloadIds = dto.items.map((item) => item.handoverItemId);
      if (new Set(payloadIds).size !== payloadIds.length) {
        throw new BadRequestException({
          message: 'Setiap item handover hanya boleh dikembalikan sekali',
          code: 'DUPLICATE_RETURN_ITEM',
        });
      }

      // ID dari body tidak boleh menunjuk handover request lain.
      const returnableIds = new Set(returnable.map((item) => item.id));
      const foreign = dto.items.filter(
        (item) => !returnableIds.has(item.handoverItemId),
      );
      if (foreign.length) {
        throw new BadRequestException({
          message:
            'Item handover tidak berasal dari handover request peminjaman ini',
          code: 'HANDOVER_ITEM_MISMATCH',
          details: foreign.map((item) => item.handoverItemId),
        });
      }

      // Return sebagian tidak didukung oleh skema (return_records UNIQUE request_id).
      if (dto.items.length !== returnable.length) {
        throw new BadRequestException({
          message:
            'Semua barang per unit dari handover harus dikembalikan sekaligus',
          code: 'INCOMPLETE_RETURN',
          details: {
            expected: returnable.length,
            received: dto.items.length,
          },
        });
      }

      const byHandoverItem = new Map(
        returnable.map((item) => [item.id, item]),
      );

      // Kunci unit fisik dengan urutan deterministik.
      const unitIds = returnable
        .map((item) => item.inventoryUnitId!)
        .sort((a, b) => a.localeCompare(b));
      const units = new Map<string, InventoryUnit>();
      for (const unitId of unitIds) {
        const unit = await manager.findOne(InventoryUnit, {
          where: { id: unitId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!unit) {
          throw new NotFoundException(
            `Unit inventaris ${unitId} tidak ditemukan`,
          );
        }
        units.set(unit.id, unit);
      }

      const record = await manager.save(
        manager.create(ReturnRecord, {
          requestId: request.id,
          returnedBy: actor.userId,
          returnedAt: new Date(),
          notes: dto.notes ?? null,
        }),
      );

      for (const line of dto.items) {
        const handoverItem = byHandoverItem.get(line.handoverItemId)!;
        const unit = units.get(handoverItem.inventoryUnitId!)!;
        await this.applyCondition(manager, actor, unit, line);

        await manager.save(
          manager.create(ReturnItem, {
            returnId: record.id,
            handoverItemId: handoverItem.id,
            returnCondition: line.returnCondition,
            notes: line.notes ?? null,
          }),
        );
      }

      // Booking selesai setelah barang kembali.
      const bookings = await manager.find(ItemBooking, {
        where: { requestId: request.id },
      });
      for (const booking of bookings) {
        if (BLOCKING_BOOKING_STATUSES.includes(booking.status)) {
          booking.status = BookingStatus.COMPLETED;
          await manager.save(booking);
        }
      }

      request.status = BorrowRequestStatus.RETURNED;
      await manager.save(request);

      return record.id;
    });

    this.logger.log(
      `Request ${dto.requestId} dikembalikan, dicatat oleh sapras ${actor.userId}`,
    );
    return this.findOne(returnId);
  }

  async findOne(id: string): Promise<ReturnResponseDto> {
    const record = await this.dataSource.manager.findOne(ReturnRecord, {
      where: { id },
      relations: {
        items: {
          handoverItem: {
            inventoryUnit: true,
            requestItem: { itemType: true },
          },
        },
      },
    });
    if (!record) {
      throw new NotFoundException('Return tidak ditemukan');
    }
    return ReturnResponseDto.from(record);
  }

  /** Terapkan kondisi hasil inspeksi ke unit dan catat repair bila diperlukan. */
  private async applyCondition(
    manager: EntityManager,
    actor: AuthenticatedUser,
    unit: InventoryUnit,
    line: ReturnItemDto,
  ): Promise<void> {
    switch (line.returnCondition) {
      case ItemCondition.LAYAK_PAKAI:
        unit.currentCondition = ItemCondition.LAYAK_PAKAI;
        unit.availabilityStatus = AvailabilityStatus.AVAILABLE;
        await manager.save(unit);
        return;

      case ItemCondition.PERLU_DIPERBAIKI:
        unit.currentCondition = ItemCondition.PERLU_DIPERBAIKI;
        unit.availabilityStatus = AvailabilityStatus.REPAIR;
        await manager.save(unit);
        await manager.save(
          manager.create(RepairRecord, {
            inventoryUnitId: unit.id,
            problemDescription:
              line.notes ?? 'Barang perlu diperbaiki setelah pengembalian',
            repairStatus: RepairStatus.MENUNGGU_PERBAIKAN,
            startedAt: new Date(),
            completedAt: null,
            repairNotes: null,
            handledBy: actor.userId,
          }),
        );
        return;

      case ItemCondition.RUSAK_TOTAL:
        unit.currentCondition = ItemCondition.RUSAK_TOTAL;
        unit.availabilityStatus = AvailabilityStatus.UNAVAILABLE;
        await manager.save(unit);
        return;
    }
  }
}
