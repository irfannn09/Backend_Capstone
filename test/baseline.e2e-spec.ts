import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { ItemClass, UserRole } from '../src/common/enums';
import { FaceProfile } from '../src/face/entities/face-profile.entity';
import { ConsumableStock } from '../src/inventory/entities/consumable-stock.entity';
import { InventoryUnit } from '../src/inventory/entities/inventory-unit.entity';
import { ItemCategory } from '../src/master-data/entities/item-category.entity';
import { ItemType } from '../src/master-data/entities/item-type.entity';
import { Location } from '../src/master-data/entities/location.entity';
import { createTestApp, loginAs, resetDatabase, seedUser } from './utils/test-app';

/**
 * BASELINE LOCK (Pre-Sprint 9).
 * Mengunci kondisi yang harus tetap benar sebelum & sesudah Sprint 9:
 *  - skema 20 tabel, relasi RESTRICT, constraint penting
 *  - aturan stok (request/approval tidak mengurangi stok)
 *  - fondasi rantai handover/return (hanya constraint DB; TIDAK ada workflow Sprint 9)
 *  - pemisahan role ADMIN / SAPRAS / SISWA / GURU
 */
const EXPECTED_TABLES = [
  'roles', 'users', 'profiles', 'face_profiles', 'face_verifications',
  'item_categories', 'item_types', 'locations', 'inventory_units', 'consumable_stocks', 'repair_records',
  'borrow_requests', 'borrow_request_items', 'item_bookings',
  'handover_records', 'handover_items', 'return_records', 'return_items',
  'stock_movements', 'notifications',
].sort();
const UUID0 = '3b241101-e2bb-4255-8caf-4136c566a962';
const HOUR = 3600_000;
const tomorrow = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 1); return d.getTime(); };

describe('Baseline lock - Pre-Sprint 9 (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tok: Record<'admin' | 'sapras' | 'siswa' | 'guru', string> = { admin: '', sapras: '', siswa: '', guru: '' };
  let requestId: string;
  let laptopItemId: string;
  let laptopUnitId: string;
  let spidolItemId: string;
  let saprasId: string;
  let siswaId: string;

  const http = () => request(app.getHttpServer());
  const as = (t: string, r: request.Test) => r.set('Authorization', `Bearer ${t}`);
  const count = async (t: string) => Number((await ds.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n);
  const pgCode = async (p: Promise<unknown>): Promise<string | undefined> => {
    try { await p; return undefined; } catch (e) {
      const err = e as { driverError?: { code?: string }; code?: string };
      return err.driverError?.code ?? err.code;
    }
  };

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    await resetDatabase(app);
    await seedUser(app, { role: UserRole.ADMIN, email: 'admin@sekolah.id' });
    const sapras = await seedUser(app, { role: UserRole.SAPRAS, email: 'sapras@sekolah.id' });
    const siswa = await seedUser(app, { role: UserRole.SISWA, nis: '1001', className: 'X-A' });
    const guru = await seedUser(app, { role: UserRole.GURU, nik: '3501', subject: 'TIK' });
    saprasId = sapras.id; siswaId = siswa.id;
    for (const u of [siswa, guru]) {
      await ds.getRepository(FaceProfile).save({ userId: u.id, faceTemplate: 'TPL' });
    }
    tok.admin = await loginAs(app, 'admin@sekolah.id');
    tok.sapras = await loginAs(app, 'sapras@sekolah.id');
    tok.siswa = await loginAs(app, '1001');
    tok.guru = await loginAs(app, '3501');

    const cat = await ds.getRepository(ItemCategory).save({ name: 'Elektronik' });
    const loc = await ds.getRepository(Location).save({ name: 'Gudang' });
    const laptop = await ds.getRepository(ItemType).save({ categoryId: cat.id, name: 'Laptop', itemClass: ItemClass.PER_UNIT, unitName: 'unit' });
    const spidol = await ds.getRepository(ItemType).save({ categoryId: cat.id, name: 'Spidol', itemClass: ItemClass.CONSUMABLE, unitName: 'pcs' });
    const laptopUnit = await ds.getRepository(InventoryUnit).save({ itemTypeId: laptop.id, locationId: loc.id, inventoryCode: 'LPT-001', barcode: 'BC-1' });
    laptopUnitId = laptopUnit.id;
    await ds.getRepository(ConsumableStock).save({ itemTypeId: spidol.id, currentStock: 50, minimumStock: 5 });

    // Request campuran (PER_UNIT + CONSUMABLE) sampai APPROVED lewat API Sprint 8.
    const created = await as(tok.siswa, http().post('/borrow-requests')).send({
      items: [{ itemTypeId: laptop.id, quantity: 1 }, { itemTypeId: spidol.id, quantity: 10 }],
      startAt: new Date(tomorrow() + 10 * HOUR).toISOString(),
      endAt: new Date(tomorrow() + 12 * HOUR).toISOString(),
      purpose: 'Praktikum', faceImage: 'MOCK_FACE_OK',
    }).expect(201);
    requestId = created.body.id;
    laptopItemId = created.body.items.find((i: { itemType: { name: string } }) => i.itemType.name === 'Laptop').id;
    spidolItemId = created.body.items.find((i: { itemType: { name: string } }) => i.itemType.name === 'Spidol').id;
    const approved = await as(tok.sapras, http().post(`/borrow-requests/${requestId}/approve`)).send({}).expect(200);
    expect(approved.body.bookings[0].inventoryUnit).toBeNull();
  });
  afterAll(async () => app.close());

  // ================================================================ SKEMA
  describe('skema database (terkunci)', () => {
    it('tepat 20 tabel sesuai ERD final', async () => {
      const rows = await ds.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'migrations'`);
      expect(rows.map((r: { table_name: string }) => r.table_name).sort()).toEqual(EXPECTED_TABLES);
    });
    it('tidak ada tabel forecasting / AI / history tambahan', async () => {
      const rows = await ds.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ~* '(forecast|predict|classif|history|audit|ml_|model)'`);
      expect(rows).toEqual([]);
    });
    it('return_items tidak punya inventory_unit_id (unit via handover_items)', async () => {
      const cols = await ds.query(`SELECT column_name FROM information_schema.columns WHERE table_name='return_items' ORDER BY ordinal_position`);
      expect(cols.map((c: { column_name: string }) => c.column_name)).toEqual(['id', 'return_id', 'handover_item_id', 'return_condition', 'notes', 'created_at']);
    });
    it('28 foreign key, semuanya ON DELETE RESTRICT (data transaksi tidak ikut terhapus)', async () => {
      const rows = await ds.query(`SELECT confdeltype AS t, count(*)::int AS n FROM pg_constraint WHERE contype='f' GROUP BY 1`);
      expect(rows).toEqual([{ t: 'r', n: 28 }]);
    });
    it('4 role final tersedia', async () => {
      const rows = await ds.query(`SELECT name FROM roles ORDER BY name`);
      expect(rows.map((r: { name: string }) => r.name)).toEqual(['ADMIN', 'GURU', 'SAPRAS', 'SISWA']);
    });
  });

  // ================================================================ STOK & LIFECYCLE
  describe('aturan stok dan lifecycle setelah request APPROVED (Sprint 8)', () => {
    it('request APPROVED: stok TIDAK berkurang, tidak ada stock_movements', async () => {
      const req = await as(tok.siswa, http().get(`/borrow-requests/${requestId}`)).expect(200);
      expect(req.body.status).toBe('APPROVED');
      expect((await ds.getRepository(ConsumableStock).find())[0].currentStock).toBe(50);
      expect(await count('stock_movements')).toBe(0);
    });
    it('unit yang di-booking tetap AVAILABLE (BOOKED/BORROWED baru berlaku di handover Sprint 9)', async () => {
      const units = await ds.getRepository(InventoryUnit).find();
      expect(units.every((unit) => unit.availabilityStatus === 'AVAILABLE')).toBe(true);
    });
    it('belum ada handover / return / repair / notifikasi yang dibuat otomatis', async () => {
      for (const t of ['handover_records', 'handover_items', 'return_records', 'return_items', 'repair_records', 'notifications']) {
        expect(await count(t)).toBe(0);
      }
    });
    it('stok negatif ditolak oleh database (CHECK) walau service dilewati', async () => {
      expect(await pgCode(ds.query(`UPDATE consumable_stocks SET current_stock = -1`))).toBe('23514');
      expect((await ds.getRepository(ConsumableStock).find())[0].currentStock).toBe(50);
    });
  });

  // ================================================================ FONDASI HANDOVER/RETURN
  describe('fondasi rantai handover -> return (hanya constraint, tanpa workflow)', () => {
    it('approval menyimpan reservasi kapasitas tanpa inventory_unit_id', async () => {
      const rows = await ds.query(
        `SELECT i.id AS item_id, b.inventory_unit_id
           FROM borrow_request_items i
           JOIN item_bookings b ON b.request_id = i.request_id
          WHERE i.request_id = $1 AND i.id = $2`, [requestId, laptopItemId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].inventory_unit_id).toBeNull();
    });

    let handoverId: string;
    let laptopHandoverItemId: string;
    it('handover_records: satu per request (UNIQUE request_id)', async () => {
      const [h] = await ds.query(`INSERT INTO handover_records (request_id, handed_over_by) VALUES ($1, $2) RETURNING id`, [requestId, saprasId]);
      handoverId = h.id;
      expect(await pgCode(ds.query(`INSERT INTO handover_records (request_id, handed_over_by) VALUES ($1, $2)`, [requestId, saprasId]))).toBe('23505');
      expect(await pgCode(ds.query(`INSERT INTO handover_records (request_id, handed_over_by) VALUES ($1, $2)`, [UUID0, saprasId]))).toBe('23503');
    });
    it('handover_items: unit fisik untuk PER_UNIT, inventory_unit_id NULL untuk consumable, qty > 0', async () => {
      const [a] = await ds.query(`INSERT INTO handover_items (handover_id, request_item_id, inventory_unit_id, quantity_handed_over) VALUES ($1,$2,$3,1) RETURNING id`, [handoverId, laptopItemId, laptopUnitId]);
      laptopHandoverItemId = a.id;
      await ds.query(`INSERT INTO handover_items (handover_id, request_item_id, inventory_unit_id, quantity_handed_over) VALUES ($1,$2,NULL,10)`, [handoverId, spidolItemId]);
      expect(await pgCode(ds.query(`INSERT INTO handover_items (handover_id, request_item_id, inventory_unit_id, quantity_handed_over) VALUES ($1,$2,NULL,0)`, [handoverId, spidolItemId]))).toBe('23514');
      expect(await pgCode(ds.query(`INSERT INTO handover_items (handover_id, request_item_id, quantity_handed_over) VALUES ($1,$2,1)`, [handoverId, UUID0]))).toBe('23503');
    });
    it('return_records: satu per request; return_items mengacu ke handover_items (bukan unit langsung)', async () => {
      const [r] = await ds.query(`INSERT INTO return_records (request_id, returned_by) VALUES ($1, $2) RETURNING id`, [requestId, saprasId]);
      expect(await pgCode(ds.query(`INSERT INTO return_records (request_id, returned_by) VALUES ($1, $2)`, [requestId, saprasId]))).toBe('23505');

      await ds.query(`INSERT INTO return_items (return_id, handover_item_id, return_condition) VALUES ($1,$2,'PERLU_DIPERBAIKI')`, [r.id, laptopHandoverItemId]);
      expect(await pgCode(ds.query(`INSERT INTO return_items (return_id, handover_item_id, return_condition) VALUES ($1,$2,'LAYAK_PAKAI')`, [r.id, laptopHandoverItemId]))).toBe('23505'); // tidak bisa dikembalikan 2x
      expect(await pgCode(ds.query(`INSERT INTO return_items (return_id, handover_item_id, return_condition) VALUES ($1,$2,'LAYAK_PAKAI')`, [r.id, UUID0]))).toBe('23503');
      expect(await pgCode(ds.query(`INSERT INTO return_items (return_id, handover_item_id, return_condition) VALUES ($1,$2,'HILANG')`, [r.id, laptopHandoverItemId]))).toBe('22P02'); // enum
    });
    it('rantai terjaga: unit asal return dapat dibaca lewat handover_items', async () => {
      const rows = await ds.query(`SELECT hi.inventory_unit_id AS unit_id, ri.return_condition FROM return_items ri JOIN handover_items hi ON hi.id = ri.handover_item_id`);
      expect(rows).toEqual([{ unit_id: laptopUnitId, return_condition: 'PERLU_DIPERBAIKI' }]);
    });
    it('data transaksi tidak bisa terhapus diam-diam (RESTRICT)', async () => {
      expect(await pgCode(ds.query(`DELETE FROM handover_records WHERE id = $1`, [handoverId]))).toBe('23503');
      expect(await pgCode(ds.query(`DELETE FROM borrow_requests WHERE id = $1`, [requestId]))).toBe('23503');
      expect(await pgCode(ds.query(`DELETE FROM users WHERE id = $1`, [siswaId]))).toBe('23503');
    });
  });

  // ================================================================ ROLE
  describe('pemisahan role (matriks terkunci)', () => {
    type R = 'admin' | 'sapras' | 'siswa' | 'guru';
    // [method, path, role yang BOLEH]. Role lain wajib 403; tanpa token wajib 401.
    const MATRIX: Array<[string, string, R[]]> = [
      ['post', '/users', ['admin']],
      ['get', '/users', ['admin']],
      ['post', '/item-categories', ['admin']],
      ['post', '/item-types', ['admin']],
      ['post', '/locations', ['admin']],
      ['get', '/item-categories', ['admin', 'sapras', 'siswa', 'guru']],
      ['post', '/inventory-units', ['sapras']],
      ['post', '/consumable-stocks', ['sapras']],
      ['get', '/inventory-units', ['sapras', 'admin']],
      ['get', '/consumable-stocks', ['sapras', 'admin']],
      ['post', '/borrow-requests', ['siswa', 'guru']],
      ['get', '/borrow-requests', ['siswa', 'guru', 'sapras']],
      ['get', '/borrow-requests/pending', ['sapras']],
      ['post', `/borrow-requests/${UUID0}/approve`, ['sapras']],
      ['post', `/borrow-requests/${UUID0}/reject`, ['sapras']],
      ['post', `/borrow-requests/${UUID0}/cancel`, ['siswa', 'guru']],
      ['get', '/profiles/me', ['siswa', 'guru']],
      ['get', '/face/profile/status', ['siswa', 'guru']],
      ['post', '/face/profile', ['siswa', 'guru']],
    ];
    const ROLES: R[] = ['admin', 'sapras', 'siswa', 'guru'];

    it.each(MATRIX)('%s %s', async (method, path, allowed) => {
      for (const role of ROLES) {
        const res = await as(tok[role], (http() as unknown as Record<string, (p: string) => request.Test>)[method](path)).send({});
        if (allowed.includes(role)) {
          expect([role, res.status === 403 || res.status === 401]).toEqual([role, false]); // lolos guard (hasil bisnis/validasi boleh apa saja)
        } else {
          expect([role, res.status]).toEqual([role, 403]);
        }
      }
      const anon = await (http() as unknown as Record<string, (p: string) => request.Test>)[method](path).send({});
      expect(anon.status).toBe(401);
    });

    it('ADMIN tidak dapat menjalankan operasi SAPRAS dan SAPRAS tidak dapat mengelola user/master data', async () => {
      await as(tok.admin, http().post('/inventory-units')).send({}).expect(403);
      await as(tok.admin, http().post(`/borrow-requests/${requestId}/approve`)).send({}).expect(403);
      await as(tok.sapras, http().post('/users')).send({}).expect(403);
      await as(tok.sapras, http().post('/item-types')).send({}).expect(403);
    });
    it('SISWA/GURU tidak dapat menjadi SAPRAS: role tidak dapat diubah lewat profile maupun user', async () => {
      await as(tok.siswa, http().patch('/profiles/me')).send({ role: 'SAPRAS' }).expect(400);
      await as(tok.siswa, http().patch(`/users/${siswaId}`)).send({ role: 'SAPRAS' }).expect(403);
      await as(tok.admin, http().patch(`/users/${siswaId}`)).send({ role: 'SAPRAS' }).expect(400);
    });
  });
});
