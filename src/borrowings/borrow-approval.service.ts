import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BookingStatus, BorrowRequestStatus, ItemClass } from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ConsumableStock } from '../inventory/entities/consumable-stock.entity';
import { AvailabilityService, Shortage } from './availability.service';
import { peakConcurrentDemand } from './availability.util';
import { BorrowExpiryService } from './borrow-expiry.service';
import {
  BLOCKING_BOOKING_STATUSES,
  approvalDeadline,
  isPastApprovalDeadline,
} from './borrowings.constants';
import { BorrowRequestsService } from './borrow-requests.service';
import { ApproveBorrowRequestDto } from './dto/approve-borrow-request.dto';
import { BorrowRequestResponseDto } from './dto/borrow-request-response.dto';
import { BorrowRequestItem } from './entities/borrow-request-item.entity';
import { BorrowRequest } from './entities/borrow-request.entity';
import { ItemBooking } from './entities/item-booking.entity';

type DecisionGate = 'ok' | 'expired';

/**
 * Approval SAPRAS hanya mengunci kapasitas berdasarkan jumlah dan waktu.
 * Unit fisik PER_UNIT sengaja belum dipilih di tahap ini.
 *
 * Reservasi kapasitas disimpan sebagai ItemBooking dengan inventory_unit_id = NULL,
 * satu baris untuk setiap unit yang diminta. Saat handover, reservasi NULL diganti
 * dengan booking unit fisik yang dipilih SAPRAS.
 */
@Injectable()
export class BorrowApprovalService {
  private readonly logger = new Logger(BorrowApprovalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly availability: AvailabilityService,
    private readonly expiry: BorrowExpiryService,
    private readonly requests: BorrowRequestsService,
  ) {}

  async approve(
    actor: AuthenticatedUser,
    id: string,
    _dto: ApproveBorrowRequestDto,
  ): Promise<BorrowRequestResponseDto> {
    await this.expiry.expireOverdue();

    const gate = await this.dataSource.transaction(async (manager): Promise<DecisionGate> => {
      const request = await this.lockDecidable(manager, id);
      if (!request) return 'expired';

      const items = await manager.find(BorrowRequestItem, {
        where: { requestId: id },
        relations: { itemType: true },
      });
      const perUnit = items.filter((i) => i.itemType.itemClass === ItemClass.PER_UNIT);
      const consumables = items.filter((i) => i.itemType.itemClass === ItemClass.CONSUMABLE);
      const shortages: Shortage[] = [];

      // 1) Consumable: stok cukup setelah dikurangi komitmen request APPROVED lain.
      const sortedConsumables = [...consumables].sort((a, b) =>
        a.itemTypeId.localeCompare(b.itemTypeId),
      );
      if (sortedConsumables.length) {
        const stocks = await manager
          .createQueryBuilder(ConsumableStock, 's')
          .setLock('pessimistic_write')
          .where('s.itemTypeId IN (:...ids)', {
            ids: sortedConsumables.map((i) => i.itemTypeId),
          })
          .orderBy('s.itemTypeId', 'ASC')
          .getMany();

        for (const item of sortedConsumables) {
          const stock = stocks.find((s) => s.itemTypeId === item.itemTypeId);
          const reserved = stock
            ? await this.availability.reservedConsumable(manager, item.itemTypeId, {
                includePending: false,
                excludeRequestId: id,
              })
            : 0;
          const free = Math.max(0, (stock?.currentStock ?? 0) - reserved);
          if (item.quantityRequested > free) {
            shortages.push({
              itemTypeId: item.itemTypeId,
              name: item.itemType.name,
              requested: item.quantityRequested,
              available: free,
            });
          }
        }
      }

      // 2) PER_UNIT: kunci semua unit yang usable agar approval bersamaan
      // tidak melewati kapasitas yang sama. Unit fisik BELUM dipilih.
      const sortedPerUnit = [...perUnit].sort((a, b) =>
        a.itemTypeId.localeCompare(b.itemTypeId),
      );
      for (const item of sortedPerUnit) {
        const candidates = await this.availability
          .usableUnitsQuery(manager, item.itemTypeId)
          .setLock('pessimistic_write')
          .orderBy('u.id', 'ASC')
          .getMany();

        const physicalBooked = await this.countPhysicalBookings(
          manager,
          candidates.map((u) => u.id),
          request,
        );
        const genericReserved = await this.countCapacityReservations(
          manager,
          item.itemTypeId,
          request,
        );
        const available = Math.max(0, candidates.length - physicalBooked - genericReserved);

        if (item.quantityRequested > available) {
          shortages.push({
            itemTypeId: item.itemTypeId,
            name: item.itemType.name,
            requested: item.quantityRequested,
            available,
          });
        }
      }

      if (shortages.length) {
        throw new ConflictException({
          message: 'Ketersediaan tidak mencukupi, request tidak dapat disetujui',
          code: 'INSUFFICIENT_AVAILABILITY',
          details: shortages,
        });
      }

      // 3) Simpan reservasi kapasitas. inventory_unit_id NULL berarti unit fisik
      // belum dipilih; pemilihan dilakukan SAPRAS saat handover.
      const expiresAt = approvalDeadline(request.createdAt);
      const reservations: ItemBooking[] = [];
      for (const item of perUnit) {
        for (let i = 0; i < item.quantityRequested; i++) {
          reservations.push(
            manager.create(ItemBooking, {
              inventoryUnitId: null,
              requestId: id,
              startAt: request.startAt,
              endAt: request.endAt,
              status: BookingStatus.APPROVED,
              expiresAt,
            }),
          );
        }
      }
      if (reservations.length) await manager.save(reservations);

      request.status = BorrowRequestStatus.APPROVED;
      await manager.save(request);
      return 'ok';
    });

    this.throwIfExpired(gate);
    this.logger.log(`Request ${id} disetujui oleh sapras ${actor.userId}`);
    return this.requests.findOne(actor, id);
  }

  async reject(actor: AuthenticatedUser, id: string): Promise<BorrowRequestResponseDto> {
    await this.expiry.expireOverdue();

    const gate = await this.dataSource.transaction(async (manager): Promise<DecisionGate> => {
      const request = await this.lockDecidable(manager, id);
      if (!request) return 'expired';
      request.status = BorrowRequestStatus.REJECTED;
      await manager.save(request);
      return 'ok';
    });

    this.throwIfExpired(gate);
    this.logger.log(`Request ${id} ditolak oleh sapras ${actor.userId}`);
    return this.requests.findOne(actor, id);
  }

  private async lockDecidable(manager: EntityManager, id: string): Promise<BorrowRequest | null> {
    const request = await manager.findOne(BorrowRequest, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!request) throw new NotFoundException('Request peminjaman tidak ditemukan');

    if (request.status === BorrowRequestStatus.EXPIRED) this.throwIfExpired('expired');
    if (request.status !== BorrowRequestStatus.WAITING_APPROVAL) {
      throw new ConflictException({
        message: `Request berstatus ${request.status} dan tidak dapat diproses`,
        code: 'INVALID_STATUS',
      });
    }
    if (isPastApprovalDeadline(request.createdAt, new Date())) {
      request.status = BorrowRequestStatus.EXPIRED;
      await manager.save(request);
      return null;
    }
    return request;
  }

  private throwIfExpired(gate: DecisionGate): void {
    if (gate === 'expired') {
      throw new ConflictException({
        message:
          'Request sudah melewati batas waktu approval (2 jam) dan berstatus EXPIRED',
        code: 'REQUEST_EXPIRED',
      });
    }
  }

  /**
   * Jumlah unit fisik BERBEDA yang sudah di-booking pada rentang waktu request.
   * Satu unit bisa punya beberapa baris booking pada window yang sama; unit
   * seperti itu tetap hanya mengurangi kapasitas satu slot.
   */
  private async countPhysicalBookings(
    manager: EntityManager,
    unitIds: string[],
    request: BorrowRequest,
  ): Promise<number> {
    if (!unitIds.length) return 0;
    const row = await manager
      .createQueryBuilder(ItemBooking, 'b')
      .select('COUNT(DISTINCT b.inventoryUnitId)', 'total')
      .where('b.inventoryUnitId IN (:...unitIds)', { unitIds })
      .andWhere('b.status IN (:...blocking)', {
        blocking: BLOCKING_BOOKING_STATUSES,
      })
      .andWhere('b.startAt < :end AND b.endAt > :start', {
        start: request.startAt,
        end: request.endAt,
      })
      .andWhere('b.requestId <> :requestId', { requestId: request.id })
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  /**
   * Kapasitas generik yang sudah dijanjikan (booking inventory_unit_id = NULL).
   * Satu baris = satu slot. Reservasi yang tidak saling overlap TIDAK boleh
   * dijumlahkan; yang dihitung adalah puncak permintaan bersamaan.
   */
  private async countCapacityReservations(
    manager: EntityManager,
    itemTypeId: string,
    request: BorrowRequest,
  ): Promise<number> {
    const rows = await manager
      .createQueryBuilder(ItemBooking, 'b')
      .innerJoin(BorrowRequest, 'r', 'r.id = b.request_id')
      .innerJoin(BorrowRequestItem, 'i', 'i.request_id = r.id AND i.item_type_id = :itemTypeId', {
        itemTypeId,
      })
      .where('b.inventoryUnitId IS NULL')
      .andWhere('b.status IN (:...blocking)', {
        blocking: BLOCKING_BOOKING_STATUSES,
      })
      .andWhere('b.startAt < :end AND b.endAt > :start', {
        start: request.startAt,
        end: request.endAt,
      })
      .andWhere('b.requestId <> :requestId', { requestId: request.id })
      .select(['b.id', 'b.startAt', 'b.endAt'])
      .getMany();

    return peakConcurrentDemand(
      rows.map((row) => ({
        start: row.startAt,
        end: row.endAt,
        quantity: 1,
      })),
      request.startAt,
      request.endAt,
    );
  }
}
