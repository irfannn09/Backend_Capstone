import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import {
  AvailabilityStatus,
  ItemClass,
  ItemCondition,
  RepairStatus,
  UserRole,
} from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { InMemoryDb } from '../common/testing/in-memory-db';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';
import { ItemCategory } from '../master-data/entities/item-category.entity';
import { ItemType } from '../master-data/entities/item-type.entity';
import { Location } from '../master-data/entities/location.entity';
import { RepairsController } from './repairs.controller';
import { RepairsService } from './repairs.service';
import { RepairRecord } from './entities/repair-record.entity';

const NOW = new Date('2026-11-15T08:00:00.000Z');
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

describe('RepairsService', () => {
  let db: InMemoryDb;
  let service: RepairsService;
  let laptopType: ItemType;
  let location: Location;

  beforeEach(() => {
    db = new InMemoryDb();
    const dataSource = {
      transaction: (callback: Parameters<InMemoryDb['transaction']>[0]) =>
        db.transaction(callback),
      manager: db.manager,
    } as unknown as DataSource;
    service = new RepairsService(dataSource);

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

  function seedRepair(
    status: RepairStatus,
    unitState: {
      currentCondition?: ItemCondition;
      availabilityStatus?: AvailabilityStatus;
    } = {},
  ) {
    const unit = db.seed(InventoryUnit, [
      {
        itemTypeId: laptopType.id,
        locationId: location.id,
        inventoryCode: 'LPT-001',
        barcode: 'BC-LPT-001',
        currentCondition:
          unitState.currentCondition ?? ItemCondition.PERLU_DIPERBAIKI,
        availabilityStatus:
          unitState.availabilityStatus ?? AvailabilityStatus.REPAIR,
      },
    ])[0];

    const record = db.seed(RepairRecord, [
      {
        inventoryUnitId: unit.id,
        problemDescription: 'Layar retak',
        repairStatus: status,
        startedAt: NOW,
        completedAt: null,
        repairNotes: null,
        handledBy: actor.userId,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])[0];

    return { unit, record };
  }

  // ================================================================== START
  it('start: MENUNGGU_PERBAIKAN -> SEDANG_DIPERBAIKI, unit tetap REPAIR', async () => {
    const { record } = seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);

    const result = await service.start(actor, record.id, {
      repairNotes: 'Mulai dikerjakan',
    });

    expect(result.repairStatus).toBe(RepairStatus.SEDANG_DIPERBAIKI);
    const stored = db.all(RepairRecord)[0];
    expect(stored).toMatchObject({
      repairStatus: RepairStatus.SEDANG_DIPERBAIKI,
      repairNotes: 'Mulai dikerjakan',
      handledBy: actor.userId,
      completedAt: null,
    });
    const unit = db.all(InventoryUnit)[0];
    expect(unit.currentCondition).toBe(ItemCondition.PERLU_DIPERBAIKI);
    expect(unit.availabilityStatus).toBe(AvailabilityStatus.REPAIR);
  });

  it('start: handledBy diambil dari actor JWT, bukan dari record lama', async () => {
    const { record } = seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);
    const otherActor: AuthenticatedUser = {
      ...actor,
      userId: 'sapras-2',
    };

    await service.start(otherActor, record.id);

    expect(db.all(RepairRecord)[0].handledBy).toBe('sapras-2');
  });

  // =============================================================== COMPLETE
  it('complete: SEDANG_DIPERBAIKI -> SELESAI_DIPERBAIKI, unit LAYAK_PAKAI + AVAILABLE', async () => {
    const { record } = seedRepair(RepairStatus.SEDANG_DIPERBAIKI);

    const result = await service.complete(actor, record.id, {
      repairNotes: 'Layar diganti',
    });

    expect(result.repairStatus).toBe(RepairStatus.SELESAI_DIPERBAIKI);
    const stored = db.all(RepairRecord)[0];
    expect(stored).toMatchObject({
      repairStatus: RepairStatus.SELESAI_DIPERBAIKI,
      repairNotes: 'Layar diganti',
      handledBy: actor.userId,
    });
    expect(stored.completedAt).toBeInstanceOf(Date);
    const unit = db.all(InventoryUnit)[0];
    expect(unit.currentCondition).toBe(ItemCondition.LAYAK_PAKAI);
    expect(unit.availabilityStatus).toBe(AvailabilityStatus.AVAILABLE);
  });

  // =========================================================== UNREPAIRABLE
  it('unrepairable: SEDANG_DIPERBAIKI -> TIDAK_DAPAT_DIPERBAIKI, unit RUSAK_TOTAL + UNAVAILABLE', async () => {
    const { record } = seedRepair(RepairStatus.SEDANG_DIPERBAIKI);

    const result = await service.markUnrepairable(actor, record.id, {
      repairNotes: 'Komponen tidak tersedia',
    });

    expect(result.repairStatus).toBe(RepairStatus.TIDAK_DAPAT_DIPERBAIKI);
    const stored = db.all(RepairRecord)[0];
    expect(stored).toMatchObject({
      repairStatus: RepairStatus.TIDAK_DAPAT_DIPERBAIKI,
      repairNotes: 'Komponen tidak tersedia',
      handledBy: actor.userId,
    });
    expect(stored.completedAt).toBeInstanceOf(Date);
    const unit = db.all(InventoryUnit)[0];
    expect(unit.currentCondition).toBe(ItemCondition.RUSAK_TOTAL);
    expect(unit.availabilityStatus).toBe(AvailabilityStatus.UNAVAILABLE);
  });

  // ====================================================== ILLEGAL TRANSITION
  it('menolak MENUNGGU_PERBAIKAN -> SELESAI_DIPERBAIKI tanpa start', async () => {
    const { record } = seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);

    await expectRejectCode(
      service.complete(actor, record.id),
      'INVALID_REPAIR_TRANSITION',
    );

    expect(db.all(RepairRecord)[0].repairStatus).toBe(
      RepairStatus.MENUNGGU_PERBAIKAN,
    );
    const unit = db.all(InventoryUnit)[0];
    expect(unit.currentCondition).toBe(ItemCondition.PERLU_DIPERBAIKI);
    expect(unit.availabilityStatus).toBe(AvailabilityStatus.REPAIR);
  });

  it('menolak MENUNGGU_PERBAIKAN -> TIDAK_DAPAT_DIPERBAIKI tanpa start', async () => {
    const { record } = seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);

    await expectRejectCode(
      service.markUnrepairable(actor, record.id),
      'INVALID_REPAIR_TRANSITION',
    );

    expect(db.all(RepairRecord)[0].repairStatus).toBe(
      RepairStatus.MENUNGGU_PERBAIKAN,
    );
    expect(db.all(InventoryUnit)[0].currentCondition).toBe(
      ItemCondition.PERLU_DIPERBAIKI,
    );
  });

  it.each([
    RepairStatus.SELESAI_DIPERBAIKI,
    RepairStatus.TIDAK_DAPAT_DIPERBAIKI,
  ])('status terminal %s tidak dapat diubah lagi', async (status) => {
    const { record } = seedRepair(status);

    await expectRejectCode(
      service.start(actor, record.id),
      'INVALID_REPAIR_TRANSITION',
    );
    await expectRejectCode(
      service.complete(actor, record.id),
      'INVALID_REPAIR_TRANSITION',
    );
    await expectRejectCode(
      service.markUnrepairable(actor, record.id),
      'INVALID_REPAIR_TRANSITION',
    );

    expect(db.all(RepairRecord)[0].repairStatus).toBe(status);
  });

  it('start kedua kali ditolak (tidak ada reopen/rework)', async () => {
    const { record } = seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);
    await service.start(actor, record.id);

    await expectRejectCode(
      service.start(actor, record.id),
      'INVALID_REPAIR_TRANSITION',
    );

    expect(db.all(RepairRecord)[0].repairStatus).toBe(
      RepairStatus.SEDANG_DIPERBAIKI,
    );
  });

  // ============================================================ NOT FOUND
  it('repair ID tidak valid/tidak ditemukan ditolak 404', async () => {
    await expect(
      service.start(actor, '00000000-0000-4000-8000-000000000099'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ============================================================ TRANSACTION
  it('transaksi: kegagalan menyimpan unit membatalkan perubahan repair', async () => {
    const { record } = seedRepair(RepairStatus.SEDANG_DIPERBAIKI);
    const failingService = serviceWithFailingUnitSave();

    await expect(failingService.complete(actor, record.id)).rejects.toThrow(
      'unit save failed',
    );

    const stored = db.all(RepairRecord)[0];
    expect(stored.repairStatus).toBe(RepairStatus.SEDANG_DIPERBAIKI);
    expect(stored.completedAt).toBeNull();
    expect(stored.repairNotes).toBeNull();
    const unit = db.all(InventoryUnit)[0];
    expect(unit.currentCondition).toBe(ItemCondition.PERLU_DIPERBAIKI);
    expect(unit.availabilityStatus).toBe(AvailabilityStatus.REPAIR);
  });

  function serviceWithFailingUnitSave(): RepairsService {
    const dataSource = {
      transaction: (callback: (manager: EntityManager) => Promise<unknown>) =>
        db.transaction(async (manager) => {
          const wrapped = new Proxy(manager, {
            get(target, property, receiver) {
              if (property === 'save') {
                return async (value: object | object[]) => {
                  const first = Array.isArray(value) ? value[0] : value;
                  if (first instanceof InventoryUnit) {
                    throw new Error('unit save failed');
                  }
                  return target.save(value);
                };
              }
              const original = Reflect.get(target, property, receiver);
              return typeof original === 'function'
                ? original.bind(target)
                : original;
            },
          });
          return callback(wrapped);
        }),
      manager: db.manager,
    } as unknown as DataSource;
    return new RepairsService(dataSource);
  }

  // ================================================================== ROLE
  it('endpoint write repair hanya SAPRAS; GET boleh SAPRAS & ADMIN (read-only)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, RepairsController.prototype.start),
    ).toEqual([UserRole.SAPRAS]);
    expect(
      Reflect.getMetadata(ROLES_KEY, RepairsController.prototype.complete),
    ).toEqual([UserRole.SAPRAS]);
    expect(
      Reflect.getMetadata(ROLES_KEY, RepairsController.prototype.unrepairable),
    ).toEqual([UserRole.SAPRAS]);
    expect(Reflect.getMetadata(ROLES_KEY, RepairsController)).toEqual([
      UserRole.SAPRAS,
      UserRole.ADMIN,
    ]);
  });
});
