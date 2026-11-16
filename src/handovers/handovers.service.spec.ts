import { DataSource } from 'typeorm';
import { BorrowExpiryService } from '../borrowings/borrow-expiry.service';
import { BorrowRequestItem } from '../borrowings/entities/borrow-request-item.entity';
import { BorrowRequest } from '../borrowings/entities/borrow-request.entity';
import { ItemBooking } from '../borrowings/entities/item-booking.entity';
import { InMemoryDb } from '../common/testing/in-memory-db';
import {
  AvailabilityStatus,
  BookingStatus,
  BorrowRequestStatus,
  ItemClass,
  ItemCondition,
  StockMovementType,
  UserRole,
} from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ConsumableStock } from '../inventory/entities/consumable-stock.entity';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';
import { ItemCategory } from '../master-data/entities/item-category.entity';
import { ItemType } from '../master-data/entities/item-type.entity';
import { Location } from '../master-data/entities/location.entity';
import { StockMovement } from '../stock/entities/stock-movement.entity';
import { HandoverItem } from './entities/handover-item.entity';
import { HandoverRecord } from './entities/handover-record.entity';
import { HandoversService } from './handovers.service';

const NOW = new Date();
const START = new Date(NOW.getTime() + 60 * 60 * 1000);
const END = new Date(START.getTime() + 2 * 60 * 60 * 1000);
const actor: AuthenticatedUser = {
  userId: 'sapras-1',
  role: UserRole.SAPRAS,
  mustChangePassword: false,
};

async function expectRejectCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  const response = (caught as { getResponse(): unknown }).getResponse();
  expect(response).toMatchObject({ code });
}

describe('HandoversService', () => {
  let db: InMemoryDb;
  let service: HandoversService;
  let expiry: {
    expireOverdue: jest.Mock;
    releaseBlockingBookings: jest.Mock;
  };

  beforeEach(() => {
    db = new InMemoryDb();
    expiry = {
      expireOverdue: jest.fn().mockResolvedValue(0),
      // Meniru helper nyata: hanya booking blocking milik request yang dilepas.
      releaseBlockingBookings: jest.fn(
        async (_manager: unknown, requestIds: string[]) => {
          for (const booking of db.all(ItemBooking)) {
            if (
              requestIds.includes(booking.requestId) &&
              [BookingStatus.ACTIVE, BookingStatus.APPROVED].includes(
                booking.status,
              )
            ) {
              booking.status = BookingStatus.EXPIRED;
            }
          }
        },
      ),
    };
    const dataSource = {
      transaction: (callback: Parameters<InMemoryDb['transaction']>[0]) =>
        db.transaction(callback),
      manager: db.manager,
    } as unknown as DataSource;
    service = new HandoversService(
      dataSource,
      expiry as unknown as BorrowExpiryService,
    );
  });

  function seedBase() {
    const category = db.seed(ItemCategory, [{ name: 'Elektronik' }])[0];
    const location = db.seed(Location, [{ name: 'Gudang' }])[0];
    const laptopType = db.seed(ItemType, [
      {
        categoryId: category.id,
        name: 'Laptop',
        itemClass: ItemClass.PER_UNIT,
        unitName: 'unit',
      },
    ])[0];
    const markerType = db.seed(ItemType, [
      {
        categoryId: category.id,
        name: 'Spidol',
        itemClass: ItemClass.CONSUMABLE,
        unitName: 'pcs',
      },
    ])[0];
    return { category, location, laptopType, markerType };
  }

  function seedUnit(itemType: ItemType, location: Location, code: string) {
    return db.seed(InventoryUnit, [
      {
        itemTypeId: itemType.id,
        locationId: location.id,
        inventoryCode: code,
        barcode: `BC-${code}`,
        currentCondition: ItemCondition.LAYAK_PAKAI,
        availabilityStatus: AvailabilityStatus.AVAILABLE,
      },
    ])[0];
  }

  function seedRequest(
    itemType: ItemType,
    quantity: number,
    options: {
      status?: BorrowRequestStatus;
      requestCode?: string;
      quantityHandedOver?: number | null;
      startAt?: Date;
      endAt?: Date;
    } = {},
  ) {
    const request = db.seed(BorrowRequest, [
      {
        userId: 'siswa-1',
        requestCode: options.requestCode ?? 'BR-TEST-001',
        startAt: options.startAt ?? START,
        endAt: options.endAt ?? END,
        purpose: 'Praktikum',
        status: options.status ?? BorrowRequestStatus.APPROVED,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])[0];
    const requestItem = db.seed(BorrowRequestItem, [
      {
        requestId: request.id,
        itemTypeId: itemType.id,
        quantityRequested: quantity,
        quantityHandedOver: options.quantityHandedOver ?? null,
        notes: null,
        itemType,
      },
    ])[0];
    return { request, requestItem };
  }

  function seedBooking(request: BorrowRequest, _unit: InventoryUnit) {
    return db.seed(ItemBooking, [
      {
        inventoryUnitId: null,
        requestId: request.id,
        startAt: request.startAt,
        endAt: request.endAt,
        status: BookingStatus.APPROVED,
        expiresAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
        createdAt: NOW,
      },
    ])[0];
  }

  function seedStock(itemType: ItemType, currentStock: number) {
    return db.seed(ConsumableStock, [
      { itemTypeId: itemType.id, currentStock, minimumStock: 1 },
    ])[0];
  }

  // ================================================================ HANDOVER
  it('Test 1: request APPROVED dapat melakukan handover (unit fisik dari booking)', async () => {
    const { location, laptopType } = seedBase();
    const unit = seedUnit(laptopType, location, 'LPT-001');
    const { request } = seedRequest(laptopType, 1);
    const booking = seedBooking(request, unit);

    const result = await service.create(actor, { requestId: request.id, selections: [{ requestItemId: db.all(BorrowRequestItem)[0].id, inventoryUnitIds: [unit.id] }] });

    expect(result.requestId).toBe(request.id);
    expect(db.all(HandoverRecord)).toHaveLength(1);
    const items = db.all(HandoverItem);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      requestItemId: expect.any(String),
      inventoryUnitId: unit.id,
      quantityHandedOver: 1,
    });
    expect(db.all(InventoryUnit)[0].availabilityStatus).toBe(
      AvailabilityStatus.BORROWED,
    );
    expect(db.all(BorrowRequest)[0].status).toBe(
      BorrowRequestStatus.HANDED_OVER,
    );
    expect(db.all(BorrowRequestItem)[0].quantityHandedOver).toBe(1);
    // Reservasi kapasitas lama dilepas; booking fisik baru dibuat untuk unit yang dipilih SAPRAS.
    expect(db.all(ItemBooking)).toHaveLength(2);
    expect(db.all(ItemBooking).find((b) => b.inventoryUnitId === null)?.status).toBe(BookingStatus.EXPIRED);
    expect(db.all(ItemBooking).find((b) => b.inventoryUnitId === unit.id)?.status).toBe(BookingStatus.APPROVED);
    expect(expiry.expireOverdue).toHaveBeenCalled();
  });

  it.each([
    ['WAITING_APPROVAL', BorrowRequestStatus.WAITING_APPROVAL],
    ['EXPIRED', BorrowRequestStatus.EXPIRED],
    ['REJECTED', BorrowRequestStatus.REJECTED],
    ['CANCELLED', BorrowRequestStatus.CANCELLED],
  ])('Test 2-4: request %s tidak dapat handover', async (_label, status) => {
    const { location, laptopType } = seedBase();
    const unit = seedUnit(laptopType, location, 'LPT-001');
    const { request } = seedRequest(laptopType, 1, { status });
    seedBooking(request, unit);

    await expectRejectCode(
      service.create(actor, { requestId: request.id }),
      'INVALID_STATUS',
    );
    expect(db.all(HandoverRecord)).toHaveLength(0);
    expect(db.all(HandoverItem)).toHaveLength(0);
    expect(db.all(InventoryUnit)[0].availabilityStatus).toBe(
      AvailabilityStatus.AVAILABLE,
    );
  });

  it('Test 5: handover kedua untuk request yang sama ditolak', async () => {
    const { location, laptopType } = seedBase();
    const unit = seedUnit(laptopType, location, 'LPT-001');
    const { request } = seedRequest(laptopType, 1);
    seedBooking(request, unit);
    db.seed(HandoverRecord, [
      {
        requestId: request.id,
        handedOverBy: actor.userId,
        handedOverAt: NOW,
        notes: null,
      },
    ]);

    await expectRejectCode(
      service.create(actor, { requestId: request.id }),
      'HANDOVER_EXISTS',
    );
    expect(db.all(HandoverRecord)).toHaveLength(1);
    expect(db.all(HandoverItem)).toHaveLength(0);
  });

  it('Test 6: jumlah unit yang di-booking harus sesuai quantity request', async () => {
    const { location, laptopType } = seedBase();
    const unit = seedUnit(laptopType, location, 'LPT-001');
    const { request } = seedRequest(laptopType, 2);
    seedBooking(request, unit);

    await expectRejectCode(
      service.create(actor, { requestId: request.id, selections: [{ requestItemId: db.all(BorrowRequestItem)[0].id, inventoryUnitIds: [unit.id] }] }),
      'UNIT_QUANTITY_MISMATCH',
    );
    expect(db.all(HandoverRecord)).toHaveLength(0);
    expect(db.all(InventoryUnit)[0].availabilityStatus).toBe(
      AvailabilityStatus.AVAILABLE,
    );
  });

  it('Test 7: unit fisik harus sesuai item type request', async () => {
    const { category, location, laptopType } = seedBase();
    const projectorType = db.seed(ItemType, [
      {
        categoryId: category.id,
        name: 'Proyektor',
        itemClass: ItemClass.PER_UNIT,
        unitName: 'unit',
      },
    ])[0];
    const projector = seedUnit(projectorType, location, 'PRJ-001');
    const { request } = seedRequest(laptopType, 1);
    seedBooking(request, projector);

    await expectRejectCode(
      service.create(actor, { requestId: request.id, selections: [{ requestItemId: db.all(BorrowRequestItem)[0].id, inventoryUnitIds: [projector.id] }] }),
      'INVENTORY_UNIT_TYPE_MISMATCH',
    );
    expect(db.all(HandoverRecord)).toHaveLength(0);
    expect(db.all(InventoryUnit)[0].availabilityStatus).toBe(
      AvailabilityStatus.AVAILABLE,
    );
  });

  it('Test 8-9: handover consumable mengurangi stok dan mencatat STOCK_OUT', async () => {
    const { markerType } = seedBase();
    const { request } = seedRequest(markerType, 5);
    seedStock(markerType, 50);

    const result = await service.create(actor, { requestId: request.id });

    const stock = db.all(ConsumableStock)[0];
    expect(stock.currentStock).toBe(45);
    const movements = db.all(StockMovement);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      consumableStockId: stock.id,
      type: StockMovementType.STOCK_OUT,
      quantity: 5,
      referenceId: result.id,
      createdBy: actor.userId,
    });
    const items = db.all(HandoverItem);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      inventoryUnitId: null,
      quantityHandedOver: 5,
    });
    expect(db.all(BorrowRequest)[0].status).toBe(
      BorrowRequestStatus.HANDED_OVER,
    );
    expect(db.all(BorrowRequestItem)[0].quantityHandedOver).toBe(5);
  });

  it('Test 10: stok tidak cukup -> handover gagal, stok tidak berubah, tanpa movement', async () => {
    const { markerType } = seedBase();
    const { request } = seedRequest(markerType, 5);
    seedStock(markerType, 3);

    await expectRejectCode(
      service.create(actor, { requestId: request.id }),
      'INSUFFICIENT_STOCK',
    );
    expect(db.all(ConsumableStock)[0].currentStock).toBe(3);
    expect(db.all(StockMovement)).toHaveLength(0);
    expect(db.all(HandoverRecord)).toHaveLength(0);
    expect(db.all(BorrowRequest)[0].status).toBe(BorrowRequestStatus.APPROVED);
  });

  it('Test 11: handover multi-item atomic; satu gagal -> tidak ada perubahan sebagian', async () => {
    const { location, laptopType, markerType } = seedBase();
    const unit = seedUnit(laptopType, location, 'LPT-001');
    const request = db.seed(BorrowRequest, [
      {
        userId: 'siswa-1',
        requestCode: 'BR-ATOMIC-001',
        startAt: START,
        endAt: END,
        purpose: 'Praktikum',
        status: BorrowRequestStatus.APPROVED,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])[0];
    db.seed(BorrowRequestItem, [
      {
        requestId: request.id,
        itemTypeId: laptopType.id,
        quantityRequested: 1,
        quantityHandedOver: null,
        notes: null,
        itemType: laptopType,
      },
      {
        requestId: request.id,
        itemTypeId: markerType.id,
        quantityRequested: 5,
        quantityHandedOver: null,
        notes: null,
        itemType: markerType,
      },
    ]);
    seedBooking(request, unit);
    seedStock(markerType, 2);

    await expectRejectCode(
      service.create(actor, { requestId: request.id }),
      'INSUFFICIENT_STOCK',
    );

    expect(db.all(HandoverRecord)).toHaveLength(0);
    expect(db.all(HandoverItem)).toHaveLength(0);
    expect(db.all(StockMovement)).toHaveLength(0);
    expect(db.all(InventoryUnit)[0].availabilityStatus).toBe(
      AvailabilityStatus.AVAILABLE,
    );
    expect(db.all(ConsumableStock)[0].currentStock).toBe(2);
    expect(db.all(BorrowRequest)[0].status).toBe(BorrowRequestStatus.APPROVED);
    expect(
      db.all(BorrowRequestItem).map((item) => item.quantityHandedOver),
    ).toEqual([null, null]);
  });

  it('menolak handover bila SAPRAS belum memilih unit fisik untuk barang PER_UNIT', async () => {
    const { laptopType } = seedBase();
    const { request } = seedRequest(laptopType, 1);

    await expectRejectCode(
      service.create(actor, { requestId: request.id }),
      'UNIT_SELECTION_REQUIRED',
    );
    expect(db.all(HandoverRecord)).toHaveLength(0);
  });

  it('no-show: now >= start_at + 30 menit -> handover ditolak, request EXPIRED, booking dilepas', async () => {
    const { location, laptopType } = seedBase();
    const unit = seedUnit(laptopType, location, 'LPT-001');
    const startAt = new Date(Date.now() - 30 * 60 * 1000);
    const { request } = seedRequest(laptopType, 1, {
      startAt,
      endAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000),
    });
    const booking = seedBooking(request, unit);

    await expectRejectCode(
      service.create(actor, { requestId: request.id }),
      'REQUEST_EXPIRED',
    );
    expect(db.all(HandoverRecord)).toHaveLength(0);
    expect(db.all(BorrowRequest)[0].status).toBe(BorrowRequestStatus.EXPIRED);
    // Booking blocking ikut dilepas: tidak meninggalkan phantom booking.
    expect(booking.status).toBe(BookingStatus.EXPIRED);
    expect(db.all(ItemBooking)).toHaveLength(1);
    expect(expiry.releaseBlockingBookings).toHaveBeenCalledWith(
      expect.anything(),
      [request.id],
    );
    expect(db.all(InventoryUnit)[0].availabilityStatus).toBe(
      AvailabilityStatus.AVAILABLE,
    );
  });

  it('no-show: belum lewat start_at + 30 menit -> handover tetap boleh', async () => {
    const { location, laptopType } = seedBase();
    const unit = seedUnit(laptopType, location, 'LPT-001');
    const startAt = new Date(Date.now() - 29 * 60 * 1000);
    const { request } = seedRequest(laptopType, 1, {
      startAt,
      endAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000),
    });
    seedBooking(request, unit);

    await service.create(actor, { requestId: request.id, selections: [{ requestItemId: db.all(BorrowRequestItem)[0].id, inventoryUnitIds: [unit.id] }] });
    expect(db.all(HandoverRecord)).toHaveLength(1);
    expect(db.all(BorrowRequest)[0].status).toBe(
      BorrowRequestStatus.HANDED_OVER,
    );
  });
});
