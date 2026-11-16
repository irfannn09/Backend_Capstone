import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import {
  AvailabilityStatus,
  ItemClass,
  ItemCondition,
  RepairStatus,
  UserRole,
} from '../src/common/enums';
import { InventoryUnit } from '../src/inventory/entities/inventory-unit.entity';
import { ItemCategory } from '../src/master-data/entities/item-category.entity';
import { ItemType } from '../src/master-data/entities/item-type.entity';
import { Location } from '../src/master-data/entities/location.entity';
import { RepairRecord } from '../src/repairs/entities/repair-record.entity';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  seedUser,
} from './utils/test-app';

describe('Repair workflow (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tokens: Record<'sapras' | 'admin' | 'siswa' | 'guru', string>;
  let userIds: { sapras: string; admin: string; siswa: string; guru: string };
  let unit: InventoryUnit;

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  const action = (
    name: 'start' | 'complete' | 'unrepairable',
    id: string,
    token = tokens?.sapras,
    body: Record<string, unknown> = {},
  ) => as(token, http().post(`/repairs/${id}/${name}`)).send(body);

  const repairOf = (id: string) =>
    ds.getRepository(RepairRecord).findOneByOrFail({ id });
  const unitOf = () =>
    ds.getRepository(InventoryUnit).findOneByOrFail({ id: unit.id });

  async function seedRepair(
    status: RepairStatus,
    state: {
      currentCondition?: ItemCondition;
      availabilityStatus?: AvailabilityStatus;
    } = {},
  ): Promise<RepairRecord> {
    await ds.query(
      `UPDATE inventory_units
         SET current_condition = $1, availability_status = $2
       WHERE id = $3`,
      [
        state.currentCondition ?? ItemCondition.PERLU_DIPERBAIKI,
        state.availabilityStatus ?? AvailabilityStatus.REPAIR,
        unit.id,
      ],
    );
    return ds.getRepository(RepairRecord).save({
      inventoryUnitId: unit.id,
      problemDescription: 'Layar retak',
      repairStatus: status,
      startedAt: new Date('2026-11-15T01:00:00.000Z'),
      completedAt: null,
      repairNotes: null,
      handledBy: userIds.sapras,
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    await resetDatabase(app);

    const [sapras, admin, siswa, guru] = await Promise.all([
      seedUser(app, {
        role: UserRole.SAPRAS,
        email: 'sapras-repair@sekolah.id',
      }),
      seedUser(app, { role: UserRole.ADMIN, email: 'admin-repair@sekolah.id' }),
      seedUser(app, {
        role: UserRole.SISWA,
        name: 'Siswa Repair',
        nis: '2101',
        className: 'XII-A',
      }),
      seedUser(app, {
        role: UserRole.GURU,
        name: 'Guru Repair',
        nik: '3701',
        subject: 'Fisika',
      }),
    ]);
    userIds = {
      sapras: sapras.id,
      admin: admin.id,
      siswa: siswa.id,
      guru: guru.id,
    };
    tokens = {
      sapras: await loginAs(app, 'sapras-repair@sekolah.id'),
      admin: await loginAs(app, 'admin-repair@sekolah.id'),
      siswa: await loginAs(app, '2101'),
      guru: await loginAs(app, '3701'),
    };

    const category = await ds
      .getRepository(ItemCategory)
      .save({ name: 'Elektronik' });
    const location = await ds.getRepository(Location).save({ name: 'Gudang' });
    const laptop = await ds.getRepository(ItemType).save({
      categoryId: category.id,
      name: 'Laptop',
      itemClass: ItemClass.PER_UNIT,
      unitName: 'unit',
    });
    unit = await ds.getRepository(InventoryUnit).save({
      itemTypeId: laptop.id,
      locationId: location.id,
      inventoryCode: 'LPT-REP-001',
      barcode: 'BC-LPT-REP-001',
      currentCondition: ItemCondition.PERLU_DIPERBAIKI,
      availabilityStatus: AvailabilityStatus.REPAIR,
    });
  });

  afterAll(async () => app.close());

  beforeEach(async () => {
    await ds.query('TRUNCATE TABLE repair_records RESTART IDENTITY CASCADE');
  });

  // ================================================================== START
  it('SAPRAS memulai perbaikan: MENUNGGU_PERBAIKAN -> SEDANG_DIPERBAIKI', async () => {
    const repair = await seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);

    const res = await action('start', repair.id, tokens.sapras, {
      repairNotes: 'Mulai dikerjakan',
    }).expect(200);

    expect(res.body).toMatchObject({
      id: repair.id,
      repairStatus: RepairStatus.SEDANG_DIPERBAIKI,
      repairNotes: 'Mulai dikerjakan',
      handledBy: userIds.sapras,
      inventoryUnit: {
        id: unit.id,
        currentCondition: ItemCondition.PERLU_DIPERBAIKI,
        availabilityStatus: AvailabilityStatus.REPAIR,
      },
    });

    const stored = await repairOf(repair.id);
    expect(stored.repairStatus).toBe(RepairStatus.SEDANG_DIPERBAIKI);
    expect(stored.startedAt).toEqual(new Date('2026-11-15T01:00:00.000Z'));
    expect(stored.completedAt).toBeNull();

    const row = await unitOf();
    expect(row.currentCondition).toBe(ItemCondition.PERLU_DIPERBAIKI);
    expect(row.availabilityStatus).toBe(AvailabilityStatus.REPAIR);
  });

  // =============================================================== COMPLETE
  it('SAPRAS menyelesaikan perbaikan: SEDANG_DIPERBAIKI -> SELESAI_DIPERBAIKI (LAYAK_PAKAI + AVAILABLE)', async () => {
    const repair = await seedRepair(RepairStatus.SEDANG_DIPERBAIKI);

    const res = await action('complete', repair.id, tokens.sapras, {
      repairNotes: 'Layar diganti',
    }).expect(200);

    expect(res.body).toMatchObject({
      repairStatus: RepairStatus.SELESAI_DIPERBAIKI,
      repairNotes: 'Layar diganti',
      handledBy: userIds.sapras,
      inventoryUnit: {
        currentCondition: ItemCondition.LAYAK_PAKAI,
        availabilityStatus: AvailabilityStatus.AVAILABLE,
      },
    });
    expect(res.body.completedAt).not.toBeNull();

    const row = await unitOf();
    expect(row.currentCondition).toBe(ItemCondition.LAYAK_PAKAI);
    expect(row.availabilityStatus).toBe(AvailabilityStatus.AVAILABLE);
  });

  // =========================================================== UNREPAIRABLE
  it('SAPRAS menyatakan tidak dapat diperbaiki: TIDAK_DAPAT_DIPERBAIKI (RUSAK_TOTAL + UNAVAILABLE)', async () => {
    const repair = await seedRepair(RepairStatus.SEDANG_DIPERBAIKI);

    const res = await action('unrepairable', repair.id, tokens.sapras, {
      repairNotes: 'Komponen tidak tersedia',
    }).expect(200);

    expect(res.body).toMatchObject({
      repairStatus: RepairStatus.TIDAK_DAPAT_DIPERBAIKI,
      repairNotes: 'Komponen tidak tersedia',
      handledBy: userIds.sapras,
      inventoryUnit: {
        currentCondition: ItemCondition.RUSAK_TOTAL,
        availabilityStatus: AvailabilityStatus.UNAVAILABLE,
      },
    });
    expect(res.body.completedAt).not.toBeNull();

    const row = await unitOf();
    expect(row.currentCondition).toBe(ItemCondition.RUSAK_TOTAL);
    expect(row.availabilityStatus).toBe(AvailabilityStatus.UNAVAILABLE);
  });

  // ====================================================== ILLEGAL TRANSITION
  it('MENUNGGU_PERBAIKAN tidak boleh langsung SELESAI_DIPERBAIKI', async () => {
    const repair = await seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);

    const res = await action('complete', repair.id).expect(409);
    expect(res.body.code).toBe('INVALID_REPAIR_TRANSITION');

    expect((await repairOf(repair.id)).repairStatus).toBe(
      RepairStatus.MENUNGGU_PERBAIKAN,
    );
    const row = await unitOf();
    expect(row.currentCondition).toBe(ItemCondition.PERLU_DIPERBAIKI);
    expect(row.availabilityStatus).toBe(AvailabilityStatus.REPAIR);
  });

  it('MENUNGGU_PERBAIKAN tidak boleh langsung TIDAK_DAPAT_DIPERBAIKI', async () => {
    const repair = await seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);

    const res = await action('unrepairable', repair.id).expect(409);
    expect(res.body.code).toBe('INVALID_REPAIR_TRANSITION');

    expect((await repairOf(repair.id)).repairStatus).toBe(
      RepairStatus.MENUNGGU_PERBAIKAN,
    );
  });

  it.each([
    RepairStatus.SELESAI_DIPERBAIKI,
    RepairStatus.TIDAK_DAPAT_DIPERBAIKI,
  ])('status terminal %s tidak dapat diubah lagi', async (status) => {
    const repair = await seedRepair(status);

    for (const name of ['start', 'complete', 'unrepairable'] as const) {
      const res = await action(name, repair.id).expect(409);
      expect(res.body.code).toBe('INVALID_REPAIR_TRANSITION');
    }

    expect((await repairOf(repair.id)).repairStatus).toBe(status);
  });

  it('start dua kali ditolak (tidak ada reopen/rework)', async () => {
    const repair = await seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);
    await action('start', repair.id).expect(200);

    const res = await action('start', repair.id).expect(409);
    expect(res.body.code).toBe('INVALID_REPAIR_TRANSITION');
    expect((await repairOf(repair.id)).repairStatus).toBe(
      RepairStatus.SEDANG_DIPERBAIKI,
    );
  });

  // ================================================================== ROLE
  it('hanya SAPRAS yang boleh menulis repair; SISWA/GURU/ADMIN 403', async () => {
    const repair = await seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);

    await http().post(`/repairs/${repair.id}/start`).expect(401);
    await action('start', repair.id, tokens.siswa).expect(403);
    await action('start', repair.id, tokens.guru).expect(403);
    await action('start', repair.id, tokens.admin).expect(403);

    expect((await repairOf(repair.id)).repairStatus).toBe(
      RepairStatus.MENUNGGU_PERBAIKAN,
    );
  });

  it('GET repair: SAPRAS & ADMIN boleh, SISWA/GURU 403', async () => {
    const repair = await seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);

    await as(tokens.sapras, http().get(`/repairs/${repair.id}`)).expect(200);
    await as(tokens.admin, http().get(`/repairs/${repair.id}`)).expect(200);
    await as(tokens.siswa, http().get(`/repairs/${repair.id}`)).expect(403);
    await as(tokens.guru, http().get(`/repairs/${repair.id}`)).expect(403);
  });

  // ================================================================ PAYLOAD
  it('status akhir dan handledBy tidak boleh dikirim dari body', async () => {
    const repair = await seedRepair(RepairStatus.MENUNGGU_PERBAIKAN);

    await action('start', repair.id, tokens.sapras, {
      repairStatus: RepairStatus.SELESAI_DIPERBAIKI,
    }).expect(400);
    await action('start', repair.id, tokens.sapras, {
      handledBy: userIds.admin,
    }).expect(400);

    const stored = await repairOf(repair.id);
    expect(stored.repairStatus).toBe(RepairStatus.MENUNGGU_PERBAIKAN);
    expect(stored.handledBy).toBe(userIds.sapras);
  });

  // ============================================================== VALID ID
  it('repair ID harus valid: UUID tidak dikenal 404, format salah 400', async () => {
    await action('start', '00000000-0000-4000-8000-000000000099').expect(404);
    await action('start', 'bukan-uuid').expect(400);
  });
});
