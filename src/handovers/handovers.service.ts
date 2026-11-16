import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BorrowExpiryService } from '../borrowings/borrow-expiry.service';
import {
  BLOCKING_BOOKING_STATUSES,
  isPastNoShowDeadline,
} from '../borrowings/borrowings.constants';
import { BorrowRequestItem } from '../borrowings/entities/borrow-request-item.entity';
import { BorrowRequest } from '../borrowings/entities/borrow-request.entity';
import { ItemBooking } from '../borrowings/entities/item-booking.entity';
import {
  AvailabilityStatus,
  BookingStatus,
  BorrowRequestStatus,
  ItemClass,
  ItemCondition,
  StockMovementType,
} from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ConsumableStock } from '../inventory/entities/consumable-stock.entity';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';
import { StockMovement } from '../stock/entities/stock-movement.entity';
import { CreateHandoverDto } from './dto/create-handover.dto';
import { HandoverResponseDto } from './dto/handover-response.dto';
import { HandoverItem } from './entities/handover-item.entity';
import { HandoverRecord } from './entities/handover-record.entity';

/**
 * Handover = penyerahan barang oleh Sapras untuk request APPROVED.
 *
 * Aturan:
 *  - Hanya request APPROVED yang boleh diserahkan (WAITING_APPROVAL/EXPIRED/
 *    REJECTED/CANCELLED dan status lain ditolak).
 *  - Satu request hanya boleh punya satu handover (UNIQUE request_id).
 *  - Barang PER_UNIT dipilih fisik oleh SAPRAS saat handover. Approval hanya menyimpan reservasi kapasitas.
 *  - Barang CONSUMABLE memakai inventory_unit_id = NULL dan mengurangi
 *    consumable_stocks.current_stock + mencatat stock_movements STOCK_OUT.
 *  - Seluruh proses berjalan dalam satu transaksi (atomic).
 */
@Injectable()
export class HandoversService {
  private readonly logger = new Logger(HandoversService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly expiry: BorrowExpiryService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateHandoverDto,
  ): Promise<HandoverResponseDto> {
    // No-show (start_at + 30 menit) harus dievaluasi lebih dulu.
    // Bila request sudah EXPIRED karena no-show, handover ditolak.
    await this.expiry.expireOverdue();

    const outcome = await this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(BorrowRequest, {
        where: { id: dto.requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request) {
        throw new NotFoundException('Request peminjaman tidak ditemukan');
      }

      // Cek duplikasi lebih dulu agar request yang sudah HANDED_OVER tetap
      // menghasilkan error yang tepat (HANDOVER_EXISTS), bukan INVALID_STATUS.
      const existing = await manager.findOne(HandoverRecord, {
        where: { requestId: request.id },
      });
      if (existing) {
        throw new ConflictException({
          message: 'Handover untuk request ini sudah tercatat',
          code: 'HANDOVER_EXISTS',
        });
      }

      if (request.status !== BorrowRequestStatus.APPROVED) {
        throw new ConflictException({
          message: `Request berstatus ${request.status} dan tidak dapat diserahkan`,
          code: 'INVALID_STATUS',
        });
      }

      // No-show: APPROVED tanpa handover, now >= start_at + 30 menit.
      // Dicek ulang di dalam transaksi agar tepat di batas (08:30:00) tidak lolos
      // meskipun sapuan latar belakang belum berjalan.
      if (isPastNoShowDeadline(request.startAt, new Date())) {
        request.status = BorrowRequestStatus.EXPIRED;
        await manager.save(request);
        // Booking terkait ikut dilepas agar tidak menjadi phantom booking.
        await this.expiry.releaseBlockingBookings(manager, [request.id]);
        return { expired: true as const };
      }

      const requestItems = await manager.find(BorrowRequestItem, {
        where: { requestId: request.id },
        relations: { itemType: true },
      });
      if (!requestItems.length) {
        throw new ConflictException({
          message: 'Request peminjaman tidak memiliki barang untuk diserahkan',
          code: 'EMPTY_REQUEST',
        });
      }

      const perUnitItems = requestItems.filter(
        (item) => item.itemType.itemClass === ItemClass.PER_UNIT,
      );
      const consumableItems = requestItems
        .filter((item) => item.itemType.itemClass === ItemClass.CONSUMABLE)
        .sort((a, b) => a.itemTypeId.localeCompare(b.itemTypeId));

      // 1) Kunci stok consumable (urutan deterministik by item_type_id) lalu validasi.
      const stocks = new Map<string, ConsumableStock>();
      for (const item of consumableItems) {
        const stock = await manager.findOne(ConsumableStock, {
          where: { itemTypeId: item.itemTypeId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!stock) {
          throw new ConflictException({
            message: `Stok untuk ${item.itemType.name} belum tersedia`,
            code: 'STOCK_NOT_FOUND',
            details: [{ itemTypeId: item.itemTypeId, name: item.itemType.name }],
          });
        }
        if (stock.currentStock < item.quantityRequested) {
          throw new ConflictException({
            message: `Stok ${item.itemType.name} tidak mencukupi untuk handover`,
            code: 'INSUFFICIENT_STOCK',
            details: [
              {
                itemTypeId: item.itemTypeId,
                name: item.itemType.name,
                requested: item.quantityRequested,
                available: stock.currentStock,
              },
            ],
          });
        }
        stocks.set(item.itemTypeId, stock);
      }

      // 2) Validasi pilihan unit fisik dari SAPRAS saat handover.
      // Approval hanya membuat reservasi kapasitas dengan inventory_unit_id = NULL.
      const selectionMap = new Map<string, string[]>();
      for (const selection of dto.selections ?? []) {
        if (selectionMap.has(selection.requestItemId)) {
          throw new BadRequestException(
            `requestItemId ${selection.requestItemId} dipilih lebih dari sekali`,
          );
        }
        selectionMap.set(selection.requestItemId, selection.inventoryUnitIds);
      }

      const requestItemIds = new Set(requestItems.map((item) => item.id));
      for (const selection of dto.selections ?? []) {
        if (!requestItemIds.has(selection.requestItemId)) {
          throw new BadRequestException(
            `requestItemId ${selection.requestItemId} bukan bagian dari request ini`,
          );
        }
        const item = requestItems.find((row) => row.id === selection.requestItemId)!;
        if (item.itemType.itemClass !== ItemClass.PER_UNIT) {
          throw new BadRequestException(
            `Item ${item.itemType.name} adalah CONSUMABLE dan tidak menerima pilihan unit fisik`,
          );
        }
      }

      const selectedUnits = new Map<string, InventoryUnit[]>();
      const selectedUnitIds = new Set<string>();
      for (const item of perUnitItems) {
        const ids = selectionMap.get(item.id);
        if (!ids) {
          throw new ConflictException({
            message: `Unit fisik untuk ${item.itemType.name} wajib dipilih saat handover`,
            code: 'UNIT_SELECTION_REQUIRED',
          });
        }
        if (ids.length !== item.quantityRequested) {
          throw new ConflictException({
            message: `Jumlah unit ${item.itemType.name} yang diserahkan harus tepat ${item.quantityRequested} (dipilih ${ids.length})`,
            code: 'UNIT_QUANTITY_MISMATCH',
            details: [
              {
                requestItemId: item.id,
                itemTypeId: item.itemTypeId,
                name: item.itemType.name,
                requested: item.quantityRequested,
                selected: ids.length,
              },
            ],
          });
        }

        const units = new Map<string, InventoryUnit>();
        for (const unitId of ids) {
          if (selectedUnitIds.has(unitId)) {
            throw new ConflictException({
              message: `Unit ${unitId} dipilih lebih dari sekali dalam request ini`,
              code: 'DUPLICATE_INVENTORY_UNIT',
              details: [unitId],
            });
          }
          const unit = await manager.findOne(InventoryUnit, {
            where: { id: unitId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!unit) {
            throw new NotFoundException(`Unit inventaris ${unitId} tidak ditemukan`);
          }
          units.set(unit.id, unit);
          selectedUnitIds.add(unit.id);
        }

        const chosen = [...units.values()];
        for (const unit of chosen) {
          if (unit.itemTypeId !== item.itemTypeId) {
            throw new ConflictException({
              message: `Unit ${unit.inventoryCode} bukan tipe barang ${item.itemType.name}`,
              code: 'INVENTORY_UNIT_TYPE_MISMATCH',
              details: [unit.id],
            });
          }
          if (unit.availabilityStatus === AvailabilityStatus.BORROWED) {
            throw new ConflictException({
              message: `Unit ${unit.inventoryCode} sedang dipinjam`,
              code: 'UNIT_NOT_USABLE',
              details: [unit.id],
            });
          }
          if (
            unit.availabilityStatus === AvailabilityStatus.REPAIR ||
            unit.availabilityStatus === AvailabilityStatus.UNAVAILABLE
          ) {
            throw new ConflictException({
              message: `Unit ${unit.inventoryCode} tidak tersedia (${unit.availabilityStatus})`,
              code: 'UNIT_NOT_USABLE',
              details: [unit.id],
            });
          }
          if (unit.currentCondition !== ItemCondition.LAYAK_PAKAI) {
            throw new ConflictException({
              message: `Kondisi unit ${unit.inventoryCode} tidak layak pakai (${unit.currentCondition})`,
              code: 'UNIT_NOT_USABLE',
              details: [unit.id],
            });
          }
          const conflict = await this.findOverlappingBooking(
            manager,
            unit.id,
            request,
          );
          if (conflict) {
            throw new ConflictException({
              message: `Unit ${unit.inventoryCode} sudah di-booking request lain pada waktu yang overlap`,
              code: 'BOOKING_CONFLICT',
              details: [unit.id],
            });
          }
        }
        selectedUnits.set(item.id, chosen);
      }

      const perUnitQuantity = perUnitItems.reduce(
        (total, item) => total + item.quantityRequested,
        0,
      );
      const reservationRows = (
        await manager.find(ItemBooking, { where: { requestId: request.id } })
      ).filter(
        (booking) =>
          booking.inventoryUnitId === null &&
          BLOCKING_BOOKING_STATUSES.includes(booking.status),
      );
      if (reservationRows.length !== perUnitQuantity) {
        throw new ConflictException({
          message:
            'Reservasi kapasitas unit untuk request ini tidak lengkap atau sudah dilepas',
          code: 'CAPACITY_RESERVATION_MISSING',
          details: {
            expected: perUnitQuantity,
            actual: reservationRows.length,
          },
        });
      }

      // Setelah unit fisik tervalidasi, reservasi kapasitas NULL diganti
      // menjadi booking unit fisik yang dipilih SAPRAS.
      await manager.update(
        ItemBooking,
        { requestId: request.id, inventoryUnitId: null },
        { status: BookingStatus.EXPIRED },
      );

      // 4) Tulis handover + item + perubahan stok dalam transaksi yang sama.
      const handover = await manager.save(
        manager.create(HandoverRecord, {
          requestId: request.id,
          handedOverBy: actor.userId,
          handedOverAt: new Date(),
          notes: dto.notes ?? null,
        }),
      );

      const handoverItems: HandoverItem[] = [];
      for (const item of perUnitItems) {
        for (const unit of selectedUnits.get(item.id) ?? []) {
          handoverItems.push(
            manager.create(HandoverItem, {
              handoverId: handover.id,
              requestItemId: item.id,
              inventoryUnitId: unit.id,
              quantityHandedOver: 1,
            }),
          );
          await manager.save(
            manager.create(ItemBooking, {
              inventoryUnitId: unit.id,
              requestId: request.id,
              startAt: request.startAt,
              endAt: request.endAt,
              status: BookingStatus.APPROVED,
              expiresAt: new Date(request.createdAt.getTime() + 2 * 60 * 60 * 1000),
            }),
          );
          // Unit sedang dipinjam: tidak boleh dianggap AVAILABLE oleh proses lain.
          unit.availabilityStatus = AvailabilityStatus.BORROWED;
          await manager.save(unit);
        }
      }

      for (const item of consumableItems) {
        const stock = stocks.get(item.itemTypeId)!;
        handoverItems.push(
          manager.create(HandoverItem, {
            handoverId: handover.id,
            requestItemId: item.id,
            inventoryUnitId: null,
            quantityHandedOver: item.quantityRequested,
          }),
        );

        // Stok berkurang HANYA di handover, bukan saat request/approval.
        stock.currentStock -= item.quantityRequested;
        await manager.save(stock);

        await manager.save(
          manager.create(StockMovement, {
            consumableStockId: stock.id,
            type: StockMovementType.STOCK_OUT,
            quantity: item.quantityRequested,
            referenceId: handover.id,
            notes: `Handover ${request.requestCode}`,
            createdBy: actor.userId,
          }),
        );
      }
      await manager.save(handoverItems);

      for (const item of requestItems) {
        item.quantityHandedOver = item.quantityRequested;
      }
      await manager.save(requestItems);

      request.status = BorrowRequestStatus.HANDED_OVER;
      await manager.save(request);

      return { expired: false as const, handoverId: handover.id };
    });

    if (outcome.expired) {
      throw new ConflictException({
        message:
          'Request sudah melewati batas no-show (start_at + 30 menit) dan berstatus EXPIRED',
        code: 'REQUEST_EXPIRED',
      });
    }

    this.logger.log(
      `Request ${dto.requestId} diserahkan oleh sapras ${actor.userId}`,
    );
    return this.findOne(outcome.handoverId);
  }

  async findOne(id: string): Promise<HandoverResponseDto> {
    const record = await this.dataSource.manager.findOne(HandoverRecord, {
      where: { id },
      relations: {
        items: {
          inventoryUnit: true,
          requestItem: { itemType: true },
        },
      },
    });
    if (!record) {
      throw new NotFoundException('Handover tidak ditemukan');
    }
    return HandoverResponseDto.from(record);
  }

  /** Booking milik request lain yang overlap dengan periode request ini. */
  private async findOverlappingBooking(
    manager: EntityManager,
    unitId: string,
    request: BorrowRequest,
  ): Promise<ItemBooking | undefined> {
    const rows = await manager.find(ItemBooking, {
      where: { inventoryUnitId: unitId },
    });
    return rows.find(
      (booking) =>
        booking.requestId !== request.id &&
        BLOCKING_BOOKING_STATUSES.includes(booking.status) &&
        booking.startAt.getTime() < request.endAt.getTime() &&
        booking.endAt.getTime() > request.startAt.getTime(),
    );
  }
}
