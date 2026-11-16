import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Brackets, DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { BorrowRequestStatus, ItemClass, ItemCondition } from '../common/enums';
import { ConsumableStock } from '../inventory/entities/consumable-stock.entity';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';
import { ItemType } from '../master-data/entities/item-type.entity';
import { peakConcurrentDemand } from './availability.util';
import {
  APPROVAL_WINDOW_MS,
  BLOCKING_BOOKING_STATUSES,
  UNUSABLE_AVAILABILITY,
} from './borrowings.constants';
import { BorrowRequestItem } from './entities/borrow-request-item.entity';
import { ItemBooking } from './entities/item-booking.entity';

export interface TimeWindow {
  startAt: Date;
  endAt: Date;
}

export interface ItemAvailability {
  itemTypeId: string;
  name: string;
  itemClass: ItemClass;
  unitName: string;
  window: { startAt: string; endAt: string } | null;
  /** PER_UNIT: jumlah semua unit / unit yang layak & tidak sedang repair/unavailable. */
  totalUnits: number | null;
  usableUnits: number | null;
  /** CONSUMABLE: stok saat ini. */
  currentStock: number | null;
  /** Yang sudah "terpakai": booking (PER_UNIT) atau komitmen request (CONSUMABLE). */
  reserved: number;
  /** Yang masih bisa diminta. */
  available: number;
}

export interface Shortage {
  itemTypeId: string;
  name: string;
  requested: number;
  available: number;
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly dataSource: DataSource) {}

  /** Unit yang boleh dipinjam: kondisi layak dan tidak sedang repair/unavailable. */
  usableUnitsQuery(manager: EntityManager, itemTypeId: string): SelectQueryBuilder<InventoryUnit> {
    return manager
      .createQueryBuilder(InventoryUnit, 'u')
      .where('u.itemTypeId = :itemTypeId', { itemTypeId })
      .andWhere('u.currentCondition = :ok', { ok: ItemCondition.LAYAK_PAKAI })
      .andWhere('u.availabilityStatus NOT IN (:...unusable)', { unusable: UNUSABLE_AVAILABILITY });
  }

  /**
   * Ketersediaan satu tipe barang.
   * PER_UNIT   : usable units - puncak (booking yang overlap + request pending lain yang overlap)
   * CONSUMABLE : current_stock - (request APPROVED yang belum diserahkan + request pending lain)
   * Tidak ada pengurangan stok di Sprint 8; ini hanya perhitungan baca.
   */
  async forItemType(
    itemTypeId: string,
    window: TimeWindow | null,
    options: { manager?: EntityManager; excludeRequestId?: string; now?: Date } = {},
  ): Promise<ItemAvailability> {
    const manager = options.manager ?? this.dataSource.manager;
    const now = options.now ?? new Date();

    const type = await manager.findOne(ItemType, { where: { id: itemTypeId } });
    if (!type) throw new NotFoundException('Tipe barang tidak ditemukan');

    const base = {
      itemTypeId: type.id,
      name: type.name,
      itemClass: type.itemClass,
      unitName: type.unitName,
      window: window
        ? { startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString() }
        : null,
    };

    if (type.itemClass === ItemClass.CONSUMABLE) {
      const stock = await manager.findOne(ConsumableStock, { where: { itemTypeId } });
      if (!stock) {
        return { ...base, totalUnits: null, usableUnits: null, currentStock: 0, reserved: 0, available: 0 };
      }
      const reserved = await this.reservedConsumable(manager, itemTypeId, {
        includePending: true,
        excludeRequestId: options.excludeRequestId,
        now,
      });
      return {
        ...base,
        totalUnits: null,
        usableUnits: null,
        currentStock: stock.currentStock,
        reserved,
        available: Math.max(0, stock.currentStock - reserved),
      };
    }

    if (!window) {
      throw new BadRequestException('startAt dan endAt wajib diisi untuk barang PER_UNIT');
    }

    const totalUnits = await manager.count(InventoryUnit, { where: { itemTypeId } });
    const usableUnits = await this.usableUnitsQuery(manager, itemTypeId).getCount();

    // Booking fisik aktif pada unit yang masih usable dan overlap dengan window.
    // Satu unit fisik hanya menempati satu slot, walau ada beberapa baris booking
    // pada window yang sama. Unit yang overlap pada window dianggap tidak tersedia
    // untuk seluruh window (booking harus bebas overlap penuh).
    const bookings = await manager
      .createQueryBuilder(ItemBooking, 'b')
      .innerJoin('b.inventoryUnit', 'u')
      .where('u.itemTypeId = :itemTypeId', { itemTypeId })
      .andWhere('u.currentCondition = :ok', { ok: ItemCondition.LAYAK_PAKAI })
      .andWhere('u.availabilityStatus NOT IN (:...unusable)', { unusable: UNUSABLE_AVAILABILITY })
      .andWhere('b.status IN (:...blocking)', { blocking: BLOCKING_BOOKING_STATUSES })
      .andWhere('b.startAt < :end AND b.endAt > :start', { start: window.startAt, end: window.endAt })
      .getMany();

    // Booking kapasitas NULL dibuat saat approval. Satu baris = satu unit
    // yang sudah disetujui tetapi belum dipilih fisiknya oleh SAPRAS.
    const capacityReservations = await manager
      .createQueryBuilder(ItemBooking, 'b')
      .innerJoin(BorrowRequestItem, 'i', 'i.request_id = b.request_id AND i.item_type_id = :itemTypeId', { itemTypeId })
      .where('b.inventoryUnitId IS NULL')
      .andWhere('b.status IN (:...blocking)', { blocking: BLOCKING_BOOKING_STATUSES })
      .andWhere('b.startAt < :end AND b.endAt > :start', { start: window.startAt, end: window.endAt })
      .select(['b.id', 'b.startAt', 'b.endAt'])
      .getMany();

    // Request lain yang masih menunggu keputusan (belum lewat deadline) ikut "menahan" kuota.
    const pendingQb = manager
      .createQueryBuilder(BorrowRequestItem, 'i')
      .innerJoinAndSelect('i.request', 'r')
      .where('i.itemTypeId = :itemTypeId', { itemTypeId })
      .andWhere('r.status = :waiting', { waiting: BorrowRequestStatus.WAITING_APPROVAL })
      .andWhere('r.createdAt >= :cutoff', { cutoff: new Date(now.getTime() - APPROVAL_WINDOW_MS) })
      .andWhere('r.startAt < :end AND r.endAt > :start', { start: window.startAt, end: window.endAt });
    if (options.excludeRequestId) {
      pendingQb.andWhere('r.id <> :excludeId', { excludeId: options.excludeRequestId });
    }
    const pending = await pendingQb.getMany();

    const physicalUnitIds = new Set(
      bookings.map((booking) => booking.inventoryUnitId),
    );

    const reserved = peakConcurrentDemand(
      [
        ...[...physicalUnitIds].map(() => ({
          start: window.startAt,
          end: window.endAt,
          quantity: 1,
        })),
        ...capacityReservations.map((booking) => ({
          start: booking.startAt,
          end: booking.endAt,
          quantity: 1,
        })),
        ...pending.map((i) => ({ start: i.request.startAt, end: i.request.endAt, quantity: i.quantityRequested })),
      ],
      window.startAt,
      window.endAt,
    );

    return {
      ...base,
      totalUnits,
      usableUnits,
      currentStock: null,
      reserved,
      available: Math.max(0, usableUnits - reserved),
    };
  }

  /**
   * Total qty consumable yang sudah "dijanjikan" ke request lain:
   * APPROVED (belum diserahkan; stok baru berkurang saat handover Sprint 9)
   * + opsional WAITING_APPROVAL yang belum lewat deadline.
   */
  async reservedConsumable(
    manager: EntityManager,
    itemTypeId: string,
    options: { includePending: boolean; excludeRequestId?: string; now?: Date },
  ): Promise<number> {
    const now = options.now ?? new Date();
    const qb = manager
      .createQueryBuilder(BorrowRequestItem, 'i')
      .innerJoin('i.request', 'r')
      .select('COALESCE(SUM(i.quantityRequested), 0)', 'total')
      .where('i.itemTypeId = :itemTypeId', { itemTypeId })
      .andWhere(
        new Brackets((b) => {
          b.where('r.status = :approved', { approved: BorrowRequestStatus.APPROVED });
          if (options.includePending) {
            b.orWhere('(r.status = :waiting AND r.createdAt >= :cutoff)', {
              waiting: BorrowRequestStatus.WAITING_APPROVAL,
              cutoff: new Date(now.getTime() - APPROVAL_WINDOW_MS),
            });
          }
        }),
      );
    if (options.excludeRequestId) qb.andWhere('r.id <> :excludeId', { excludeId: options.excludeRequestId });
    const row = await qb.getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  /**
   * Validasi seluruh baris cart terhadap ketersediaan. Dipanggil di dalam transaksi
   * dan setelah advisory lock per item type, sehingga dua submit bersamaan terserialisasi.
   */
  async assertAvailable(
    manager: EntityManager,
    lines: Array<{ itemTypeId: string; quantity: number }>,
    window: TimeWindow,
    now: Date,
  ): Promise<void> {
    const shortages: Shortage[] = [];
    for (const line of [...lines].sort((a, b) => a.itemTypeId.localeCompare(b.itemTypeId))) {
      const availability = await this.forItemType(line.itemTypeId, window, { manager, now });
      if (line.quantity > availability.available) {
        shortages.push({
          itemTypeId: line.itemTypeId,
          name: availability.name,
          requested: line.quantity,
          available: availability.available,
        });
      }
    }
    if (shortages.length) {
      throw new ConflictException({
        message: 'Ketersediaan barang tidak mencukupi untuk waktu yang diminta',
        code: 'INSUFFICIENT_AVAILABILITY',
        details: shortages,
      });
    }
  }
}
