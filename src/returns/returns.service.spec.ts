import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { InMemoryDb } from '../common/testing/in-memory-db';
import {
  AvailabilityStatus,
  BookingStatus,
  BorrowRequestStatus,
  ItemClass,
  ItemCondition,
  RepairStatus,
  UserRole,
} from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { BorrowRequestItem } from '../borrowings/entities/borrow-request-item.entity';
import { BorrowRequest } from '../borrowings/entities/borrow-request.entity';
import { ItemBooking } from '../borrowings/entities/item-booking.entity';
import { HandoverItem } from '../handovers/entities/handover-item.entity';
import { HandoverRecord } from '../handovers/entities/handover-record.entity';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';
import { ItemCategory } from '../master-data/entities/item-category.entity';
import { ItemType } from '../master-data/entities/item-type.entity';
import { Location } from '../master-data/entities/location.entity';
import { RepairRecord } from '../repairs/entities/repair-record.entity';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { ReturnItem } from './entities/return-item.entity';
import { ReturnRecord } from './entities/return-record.entity';

const NOW = new Date('2026-11-14T08:00:00.000Z');
const START = new Date('2026-11-14T09:00:00.000Z');
const END = new Date('2026-11-14T11:00:00.000Z');
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

describe('ReturnsService', () => {
  let db: InMemoryDb;
  let service: ReturnsService;
  let laptopType: ItemType;
  let location: Location;

  beforeEach(() => {
    db = new InMemoryDb();
    const dataSource = {
      transaction: (callback: Parameters<InMemoryDb['transaction']>[0]) =>
        db.transaction(callback),
      manager: db.manager,
    } as unknown as DataSource;
    service = new ReturnsService(dataSource);

    const category = db.seed(ItemCategory, [{ name: 'Elektronik' }])[0];
    location = db.seed(Location, [{ name: 'Gudang' }])[0];
    laptopType = db.seed(ItemType, [
      {
        categoryId: category.id,
        name: 'Laptop',
        itemClass: ItemClass.PER_UNIT,
        unitName: 'unit',
      },
    ])[0];
  });

  function seedHandover(options: {
    code: string;
    units?: number;
    status?: BorrowRequestStatus;
    unitStatus?: AvailabilityStatus;
    withHandover?: boolean;
  }) {
    const request = db.seed(BorrowRequest, [
      {
        userId: 'siswa-1',
        requestCode: options.code,
        startAt: START,
        endAt: END,
        purpose: 'Praktikum',
        status: options.status ?? BorrowRequestStatus.HANDED_OVER,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])[0];

    const unitCount = options.units ?? 1;
    const requestItem = db.seed(BorrowRequestItem, [
      {
        requestId: request.id,
        itemTypeId: laptopType.id,
        quantityRequested: unitCount,
        quantityHandedOver: unitCount,
        notes: null,
        itemType: laptopType,
      },
    ])[0];

    const units: InventoryUnit[] = [];
    const handoverItems: HandoverItem[] = [];
    if (options.withHandover !== false) {
      const handover = db.seed(HandoverRecord, [
        {
          requestId: request.id,
          handedOverBy: actor.userId,
          handedOverAt: NOW,
          notes: null,
        },
      ])[0];
      for (let index = 1; index <= unitCount; index += 1) {
        const unit = db.seed(InventoryUnit, [
          {
            itemTypeId: laptopType.id,
            locationId: location.id,
            inventoryCode: `${options.code}-${index}`,
            barcode: `BC-${options.code}-${index}`,
            currentCondition: ItemCondition.LAYAK_PAKAI,
            availabilityStatus:
              options.unitStatus ?? AvailabilityStatus.BORROWED,
          },
        ])[0];
        units.push(unit);
        handoverItems.push(
          db.seed(HandoverItem, [
            {
              handoverId: handover.id,
              requestItemId: requestItem.id,
              inventoryUnitId: unit.id,
              quantityHandedOver: 1,
            },
          ])[0],
        );
        db.seed(ItemBooking, [
          {
            inventoryUnitId: unit.id,
            requestId: request.id,
            startAt: START,
            endAt: END,
            status: BookingStatus.APPROVED,
            expiresAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
            createdAt: NOW,
          },
        ]);
      }
    }
    return { request, requestItem, units, handoverItems };
  }

  // =================================================================== RETURN
  it('Test 12: barang per unit dari handover dapat dikembalikan', async () => {
    const { request, handoverItems } = seedHandover({ code: 'BR-001' });

    const result = await service.create(actor, {
      requestId: request.id,
      items: [
        {
          handoverItemId: handoverItems[0].id,
          returnCondition: ItemCondition.LAYAK_PAKAI,
        },
      ],
    });

    expect(result.requestId).toBe(request.id);
    expect(db.all(ReturnRecord)).toHaveLength(1);
    const returnItems = db.all(ReturnItem);
    expect(returnItems).toHaveLength(1);
    expect(returnItems[0]).toMatchObject({
      handoverItemId: handoverItems[0].id,
      returnCondition: ItemCondition.LAYAK_PAKAI,
    });
    expect(db.all(BorrowRequest)[0].status).toBe(
      BorrowRequestStatus.RETURNED,
    );
    expect(db.all(ItemBooking)[0].status).toBe(BookingStatus.COMPLETED);
  });

  it('Test 13: return item harus berasal dari handover request yang benar', async () => {
    const first = seedHandover({ code: 'BR-001' });
    const second = seedHandover({ code: 'BR-002' });

    await expectRejectCode(
      service.create(actor, {
        requestId: first.request.id,
        items: [
          {
            handoverItemId: second.handoverItems[0].id,
            returnCondition: ItemCondition.LAYAK_PAKAI,
          },
        ],
      }),
      'HANDOVER_ITEM_MISMATCH',
    );

    expect(db.all(ReturnRecord)).toHaveLength(0);
    expect(db.all(ReturnItem)).toHaveLength(0);
    expect(db.all(BorrowRequest).map((row) => row.status)).toEqual([
      BorrowRequestStatus.HANDED_OVER,
      BorrowRequestStatus.HANDED_OVER,
    ]);
  });

  it('Test 14: duplicate return ditolak (request & payload)', async () => {
    const { request, handoverItems } = seedHandover({ code: 'BR-001' });
    const payload = {
      requestId: request.id,
      items: [
        {
          handoverItemId: handoverItems[0].id,
          returnCondition: ItemCondition.LAYAK_PAKAI,
        },
      ],
    };

    await expectRejectCode(
      service.create(actor, {
        requestId: request.id,
        items: [...payload.items, ...payload.items],
      }),
      'DUPLICATE_RETURN_ITEM',
    );

    await service.create(actor, payload);
    await expectRejectCode(
      service.create(actor, payload),
      'RETURN_EXISTS',
    );
    expect(db.all(ReturnRecord)).toHaveLength(1);
  });

  it('Test 15: LAYAK_PAKAI -> unit kembali AVAILABLE dengan kondisi layak', async () => {
    const { request, handoverItems } = seedHandover({ code: 'BR-001' });

    await service.create(actor, {
      requestId: request.id,
      items: [
        {
          handoverItemId: handoverItems[0].id,
          returnCondition: ItemCondition.LAYAK_PAKAI,
        },
      ],
    });

    const unit = db.all(InventoryUnit)[0];
    expect(unit.availabilityStatus).toBe(AvailabilityStatus.AVAILABLE);
    expect(unit.currentCondition).toBe(ItemCondition.LAYAK_PAKAI);
    expect(db.all(RepairRecord)).toHaveLength(0);
  });

  it('Test 16: PERLU_DIPERBAIKI -> unit REPAIR dan repair record tercatat', async () => {
    const { request, handoverItems } = seedHandover({ code: 'BR-001' });

    await service.create(actor, {
      requestId: request.id,
      items: [
        {
          handoverItemId: handoverItems[0].id,
          returnCondition: ItemCondition.PERLU_DIPERBAIKI,
          notes: 'Layar retak',
        },
      ],
    });

    const unit = db.all(InventoryUnit)[0];
    expect(unit.availabilityStatus).toBe(AvailabilityStatus.REPAIR);
    expect(unit.currentCondition).toBe(ItemCondition.PERLU_DIPERBAIKI);
    const repairs = db.all(RepairRecord);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({
      inventoryUnitId: unit.id,
      problemDescription: 'Layar retak',
      repairStatus: RepairStatus.MENUNGGU_PERBAIKAN,
      handledBy: actor.userId,
    });
  });

  it('Test 17: RUSAK_TOTAL -> unit tidak kembali AVAILABLE', async () => {
    const { request, handoverItems } = seedHandover({ code: 'BR-001' });

    await service.create(actor, {
      requestId: request.id,
      items: [
        {
          handoverItemId: handoverItems[0].id,
          returnCondition: ItemCondition.RUSAK_TOTAL,
        },
      ],
    });

    const unit = db.all(InventoryUnit)[0];
    expect(unit.availabilityStatus).toBe(AvailabilityStatus.UNAVAILABLE);
    expect(unit.currentCondition).toBe(ItemCondition.RUSAK_TOTAL);
  });

  it('Test 18: endpoint return hanya untuk SAPRAS (ADMIN/SISWA/GURU tidak menjalankan operasional)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, ReturnsController.prototype.create),
    ).toEqual([UserRole.SAPRAS]);
  });

  it('menolak return sebagian: semua barang per unit harus dikembalikan sekaligus', async () => {
    const { request, handoverItems } = seedHandover({
      code: 'BR-001',
      units: 2,
    });

    await expectRejectCode(
      service.create(actor, {
        requestId: request.id,
        items: [
          {
            handoverItemId: handoverItems[0].id,
            returnCondition: ItemCondition.LAYAK_PAKAI,
          },
        ],
      }),
      'INCOMPLETE_RETURN',
    );
    expect(db.all(ReturnRecord)).toHaveLength(0);
    expect(db.all(InventoryUnit).map((unit) => unit.availabilityStatus)).toEqual(
      [AvailabilityStatus.BORROWED, AvailabilityStatus.BORROWED],
    );
  });

  it('menolak return untuk request yang belum HANDED_OVER', async () => {
    const { request, handoverItems } = seedHandover({
      code: 'BR-001',
      status: BorrowRequestStatus.APPROVED,
    });

    await expectRejectCode(
      service.create(actor, {
        requestId: request.id,
        items: [
          {
            handoverItemId: handoverItems[0].id,
            returnCondition: ItemCondition.LAYAK_PAKAI,
          },
        ],
      }),
      'INVALID_STATUS',
    );
    expect(db.all(ReturnRecord)).toHaveLength(0);
  });

  it('menolak return request tanpa handover', async () => {
    const { request } = seedHandover({
      code: 'BR-001',
      withHandover: false,
    });

    await expectRejectCode(
      service.create(actor, {
        requestId: request.id,
        items: [
          {
            handoverItemId: '00000000-0000-4000-8000-000000000001',
            returnCondition: ItemCondition.LAYAK_PAKAI,
          },
        ],
      }),
      'HANDOVER_NOT_FOUND',
    );
    expect(db.all(ReturnRecord)).toHaveLength(0);
  });
});
