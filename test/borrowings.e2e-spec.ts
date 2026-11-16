import { INestApplication, Logger } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource, EntityManager } from 'typeorm';
import { BorrowExpiryService } from '../src/borrowings/borrow-expiry.service';
import { BorrowRequest } from '../src/borrowings/entities/borrow-request.entity';
import { BorrowRequestItem } from '../src/borrowings/entities/borrow-request-item.entity';
import { ItemBooking } from '../src/borrowings/entities/item-booking.entity';
import {
  BookingStatus,
  BorrowRequestStatus,
  ItemClass,
  UserRole,
} from '../src/common/enums';
import { FaceProfile } from '../src/face/entities/face-profile.entity';
import { HandoverRecord } from '../src/handovers/entities/handover-record.entity';
import { ConsumableStock } from '../src/inventory/entities/consumable-stock.entity';
import { InventoryUnit } from '../src/inventory/entities/inventory-unit.entity';
import { ItemCategory } from '../src/master-data/entities/item-category.entity';
import { ItemType } from '../src/master-data/entities/item-type.entity';
import { Location } from '../src/master-data/entities/location.entity';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  seedUser,
} from './utils/test-app';

const HOUR = 3600_000;
const tomorrow = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
};
/** Rentang waktu besok (UTC): slot(10, 12) = besok 10:00-12:00. */
const slot = (from: number, to: number) => ({
  startAt: new Date(tomorrow() + from * HOUR).toISOString(),
  endAt: new Date(tomorrow() + to * HOUR).toISOString(),
});

describe('Borrowing & booking (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tokens: Record<
    'siswaA' | 'siswaB' | 'guru' | 'siswaNoFace' | 'sapras' | 'admin',
    string
  >;
  let ids: { siswaA: string; siswaB: string; guru: string };
  let laptop: ItemType;
  let proyektor: ItemType;
  let spidol: ItemType;
  let lpt1: InventoryUnit;
  let lpt2: InventoryUnit;
  let prj1: InventoryUnit;

  const http = () => request(app.getHttpServer());
  const as = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);
  const count = async (table: string) =>
    Number((await ds.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n);

  const body = (over: Record<string, unknown> = {}) => ({
    items: [{ itemTypeId: laptop.id, quantity: 1 }],
    ...slot(10, 12),
    purpose: 'Praktikum multimedia',
    faceImage: 'MOCK_FACE_OK',
    ...over,
  });
  const submit = (token: string, over: Record<string, unknown> = {}) =>
    as(token, http().post('/borrow-requests')).send(body(over));
  const approve = (id: string, payload: object = {}) =>
    as(tokens.sapras, http().post(`/borrow-requests/${id}/approve`)).send(
      payload,
    );
  const reject = (id: string) =>
    as(tokens.sapras, http().post(`/borrow-requests/${id}/reject`));

  /** Membuat request langsung di DB (melewati submit) untuk skenario approval/race. */
  async function seedPending(
    userId: string,
    items: Array<{ type: ItemType; qty: number }>,
    s: { startAt: string; endAt: string },
    ageMinutes = 0,
  ): Promise<string> {
    const r = await ds.getRepository(BorrowRequest).save(
      ds.getRepository(BorrowRequest).create({
        userId,
        requestCode: `BR-SEED-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        startAt: new Date(s.startAt),
        endAt: new Date(s.endAt),
        purpose: 'seed',
        status: BorrowRequestStatus.WAITING_APPROVAL,
      }),
    );
    for (const i of items) {
      await ds.getRepository(BorrowRequestItem).save(
        ds.getRepository(BorrowRequestItem).create({
          requestId: r.id,
          itemTypeId: i.type.id,
          quantityRequested: i.qty,
        }),
      );
    }
    if (ageMinutes) {
      await ds.query(
        `UPDATE borrow_requests SET created_at = now() - ($2::int * interval '1 minute') WHERE id = $1`,
        [r.id, ageMinutes],
      );
    }
    return r.id;
  }
  const backdate = (id: string, minutes: number) =>
    ds.query(
      `UPDATE borrow_requests SET created_at = now() - ($2::int * interval '1 minute') WHERE id = $1`,
      [id, minutes],
    );

  /** Request APPROVED + booking unit, untuk skenario no-show (start_at ditentukan test). */
  async function seedApproved(
    userId: string,
    startAt: Date,
    options: { handover?: boolean } = {},
  ): Promise<{ id: string; bookingId: string }> {
    const endAt = new Date(startAt.getTime() + 4 * HOUR);
    const request = await ds.getRepository(BorrowRequest).save(
      ds.getRepository(BorrowRequest).create({
        userId,
        requestCode: `BR-NOSHOW-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        startAt,
        endAt,
        purpose: 'seed no-show',
        status: BorrowRequestStatus.APPROVED,
      }),
    );
    await ds.getRepository(BorrowRequestItem).save(
      ds.getRepository(BorrowRequestItem).create({
        requestId: request.id,
        itemTypeId: laptop.id,
        quantityRequested: 1,
      }),
    );
    const booking = await ds.getRepository(ItemBooking).save(
      ds.getRepository(ItemBooking).create({
        inventoryUnitId: lpt1.id,
        requestId: request.id,
        startAt,
        endAt,
        status: BookingStatus.APPROVED,
        expiresAt: new Date(request.createdAt.getTime() + 2 * HOUR),
      }),
    );
    if (options.handover) {
      await ds.getRepository(HandoverRecord).save(
        ds.getRepository(HandoverRecord).create({
          requestId: request.id,
          handedOverBy: ids.siswaA,
        }),
      );
    }
    return { id: request.id, bookingId: booking.id };
  }
  /** Request APPROVED + booking unit fisik langsung (untuk skenario kapasitas). */
  async function seedPhysicalBooking(
    userId: string,
    unitId: string,
    startAt: Date,
    endAt: Date,
    status: BookingStatus = BookingStatus.APPROVED,
  ): Promise<string> {
    const request = await ds.getRepository(BorrowRequest).save(
      ds.getRepository(BorrowRequest).create({
        userId,
        requestCode: `BR-PHYS-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        startAt,
        endAt,
        purpose: 'seed physical booking',
        status: BorrowRequestStatus.APPROVED,
      }),
    );
    await ds.getRepository(BorrowRequestItem).save(
      ds.getRepository(BorrowRequestItem).create({
        requestId: request.id,
        itemTypeId: laptop.id,
        quantityRequested: 1,
      }),
    );
    await ds.getRepository(ItemBooking).save(
      ds.getRepository(ItemBooking).create({
        inventoryUnitId: unitId,
        requestId: request.id,
        startAt,
        endAt,
        status,
        expiresAt: new Date(request.createdAt.getTime() + 2 * HOUR),
      }),
    );
    return request.id;
  }

  const sweep = (now: Date) => app.get(BorrowExpiryService).expireOverdue(now);  const requestStatus = async (id: string) =>
    (await ds.getRepository(BorrowRequest).findOneByOrFail({ id })).status;
  const bookingStatus = async (id: string) =>
    (await ds.getRepository(ItemBooking).findOneByOrFail({ id })).status;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    await resetDatabase(app);

    const [admin, sapras, a, b, g, nf] = await Promise.all([
      seedUser(app, { role: UserRole.ADMIN, email: 'admin@sekolah.id' }),
      seedUser(app, { role: UserRole.SAPRAS, email: 'sapras@sekolah.id' }),
      seedUser(app, {
        role: UserRole.SISWA,
        name: 'Siswa A',
        nis: '1001',
        className: 'X-A',
      }),
      seedUser(app, {
        role: UserRole.SISWA,
        name: 'Siswa B',
        nis: '1002',
        className: 'X-B',
      }),
      seedUser(app, {
        role: UserRole.GURU,
        name: 'Guru',
        nik: '3501',
        subject: 'TIK',
      }),
      seedUser(app, {
        role: UserRole.SISWA,
        name: 'Tanpa Wajah',
        nis: '1003',
        className: 'X-C',
      }),
    ]);
    void admin;
    void sapras;
    void nf;
    ids = { siswaA: a.id, siswaB: b.id, guru: g.id };
    for (const userId of [a.id, b.id, g.id]) {
      await ds
        .getRepository(FaceProfile)
        .save(
          ds
            .getRepository(FaceProfile)
            .create({ userId, faceTemplate: 'TEMPLATE-RAHASIA' }),
        );
    }

    const cat = await ds
      .getRepository(ItemCategory)
      .save({ name: 'Elektronik' });
    const loc = await ds.getRepository(Location).save({ name: 'Gudang' });
    const mk = (name: string, itemClass: ItemClass, unitName: string) =>
      ds
        .getRepository(ItemType)
        .save({ categoryId: cat.id, name, itemClass, unitName });
    laptop = await mk('Laptop', ItemClass.PER_UNIT, 'unit');
    proyektor = await mk('Proyektor', ItemClass.PER_UNIT, 'unit');
    spidol = await mk('Spidol', ItemClass.CONSUMABLE, 'pcs');
    const unit = (t: ItemType, code: string) =>
      ds
        .getRepository(InventoryUnit)
        .save({
          itemTypeId: t.id,
          locationId: loc.id,
          inventoryCode: code,
          barcode: `BC-${code}`,
        });
    lpt1 = await unit(laptop, 'LPT-001');
    lpt2 = await unit(laptop, 'LPT-002');
    prj1 = await unit(proyektor, 'PRJ-001');
    await ds
      .getRepository(ConsumableStock)
      .save({ itemTypeId: spidol.id, currentStock: 50, minimumStock: 5 });

    tokens = {
      siswaA: await loginAs(app, '1001'),
      siswaB: await loginAs(app, '1002'),
      guru: await loginAs(app, '3501'),
      siswaNoFace: await loginAs(app, '1003'),
      sapras: await loginAs(app, 'sapras@sekolah.id'),
      admin: await loginAs(app, 'admin@sekolah.id'),
    };
  });
  afterAll(async () => app.close());

  beforeEach(async () => {
    await ds.query(
      'TRUNCATE TABLE item_bookings, face_verifications, borrow_request_items, borrow_requests, stock_movements RESTART IDENTITY CASCADE',
    );
    await ds.query(`UPDATE consumable_stocks SET current_stock = 50`);
    await ds.query(
      `UPDATE inventory_units SET availability_status = 'AVAILABLE', current_condition = 'LAYAK_PAKAI'`,
    );
  });

  // ===================================================================== CREATE
  describe('membuat request (cart -> submit)', () => {
    it('satu request berisi banyak item PER_UNIT + CONSUMABLE; status WAITING_APPROVAL; deadline = created_at + 2 jam', async () => {
      const res = await submit(tokens.siswaA, {
        items: [
          { itemTypeId: laptop.id, quantity: 1 },
          { itemTypeId: proyektor.id, quantity: 1 },
          { itemTypeId: spidol.id, quantity: 10, notes: 'warna hitam' },
        ],
      }).expect(201);

      expect(res.body.status).toBe('WAITING_APPROVAL');
      expect(res.body.requestCode).toMatch(/^BR-\d{8}-[A-Z2-9]{8}$/);
      expect(res.body.items).toHaveLength(3);
      expect(res.body.requester).toMatchObject({
        name: 'Siswa A',
        nis: '1001',
      });
      expect(res.body.bookings).toEqual([]); // unit fisik belum ditentukan
      expect(res.body.faceVerification).toMatchObject({ status: 'SUCCESS' });
      expect(
        new Date(res.body.approvalDeadline).getTime() -
          new Date(res.body.createdAt).getTime(),
      ).toBe(2 * HOUR);

      // Sprint 8 tidak memotong stok / mencatat movement / membooking unit saat submit
      expect(await count('item_bookings')).toBe(0);
      expect(await count('stock_movements')).toBe(0);
      expect(
        (
          await ds
            .getRepository(ConsumableStock)
            .findOneByOrFail({ itemTypeId: spidol.id })
        ).currentStock,
      ).toBe(50);
      expect(await count('face_verifications')).toBe(1);
      expect(JSON.stringify(res.body)).not.toMatch(
        /MOCK_FACE_OK|TEMPLATE-RAHASIA|faceTemplate|passwordHash/,
      );
    });

    it('GURU juga boleh meminjam', async () => {
      await submit(tokens.guru).expect(201);
    });

    it('tanpa autentikasi 401; SAPRAS & ADMIN tidak boleh meminjam (403)', async () => {
      await http().post('/borrow-requests').send(body()).expect(401);
      await submit(tokens.sapras).expect(403);
      await submit(tokens.admin).expect(403);
    });

    it.each([
      ['items kosong', { items: [] }],
      ['items null', { items: null }],
      ['quantity 0', { items: [{ itemTypeId: 'LAPTOP', quantity: 0 }] }],
      ['quantity negatif', { items: [{ itemTypeId: 'LAPTOP', quantity: -2 }] }],
      [
        'quantity pecahan',
        { items: [{ itemTypeId: 'LAPTOP', quantity: 1.5 }] },
      ],
      ['quantity string', { items: [{ itemTypeId: 'LAPTOP', quantity: '2' }] }],
      [
        'quantity terlalu besar',
        { items: [{ itemTypeId: 'LAPTOP', quantity: 1001 }] },
      ],
      [
        'itemTypeId bukan UUID',
        { items: [{ itemTypeId: 'abc', quantity: 1 }] },
      ],
      ['endAt == startAt', { endAt: slot(10, 12).startAt }],
      ['endAt < startAt', { ...slot(12, 10) }],
      [
        'startAt di masa lalu',
        {
          startAt: new Date(Date.now() - 3 * HOUR).toISOString(),
          endAt: new Date(Date.now() - 2 * HOUR).toISOString(),
        },
      ],
      [
        'waktu tanpa zona',
        { startAt: '2030-01-01T10:00:00', endAt: '2030-01-01T12:00:00' },
      ],
      ['waktu bukan tanggal', { startAt: 'besok', endAt: 'lusa' }],
      ['purpose kosong', { purpose: '  ' }],
      ['faceImage kosong', { faceImage: '' }],
      [
        'field asing (userId)',
        { userId: '3b241101-e2bb-4255-8caf-4136c566a962' },
      ],
      ['field asing (status)', { status: 'APPROVED' }],
      [
        'field asing inventoryUnitId pada item',
        {
          items: [
            {
              itemTypeId: 'LAPTOP',
              quantity: 1,
              inventoryUnitId: '3b241101-e2bb-4255-8caf-4136c566a962',
            },
          ],
        },
      ],
    ])('validasi 400: %s -> tidak ada data dibuat', async (_name, over) => {
      const o = JSON.parse(JSON.stringify(over, (_k, v) => v)) as Record<
        string,
        unknown
      >;
      if (Array.isArray(o.items)) {
        o.items = (o.items as Array<Record<string, unknown>>).map((i) =>
          i.itemTypeId === 'LAPTOP' ? { ...i, itemTypeId: laptop.id } : i,
        );
      }
      await submit(tokens.siswaA, o).expect(400);
      expect(await count('borrow_requests')).toBe(0);
      expect(await count('borrow_request_items')).toBe(0);
      expect(await count('face_verifications')).toBe(0);
    });

    it('tipe barang dobel dalam keranjang -> 400; tipe tidak ada -> 404', async () => {
      await submit(tokens.siswaA, {
        items: [
          { itemTypeId: laptop.id, quantity: 1 },
          { itemTypeId: laptop.id, quantity: 1 },
        ],
      }).expect(400);
      await submit(tokens.siswaA, {
        items: [
          { itemTypeId: '3b241101-e2bb-4255-8caf-4136c566a962', quantity: 1 },
        ],
      }).expect(404);
    });

    it('atomic: bila ada kegagalan di tengah transaksi, request + semua item + verifikasi ikut rollback', async () => {
      const quiet = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined); // 'boom' disengaja
      const orig = ds.transaction.bind(ds);
      const spy = jest.spyOn(ds, 'transaction').mockImplementation((async (
        cb: (m: unknown) => Promise<unknown>,
      ) =>
        orig(async (m: EntityManager) => {
          await cb(m);
          throw new Error('boom');
        })) as never);
      try {
        await submit(tokens.siswaA, {
          items: [
            { itemTypeId: laptop.id, quantity: 1 },
            { itemTypeId: spidol.id, quantity: 5 },
          ],
        }).expect(500);
      } finally {
        spy.mockRestore();
        quiet.mockRestore();
      }
      expect(await count('borrow_requests')).toBe(0);
      expect(await count('borrow_request_items')).toBe(0);
      expect(await count('face_verifications')).toBe(0);
    });
  });

  // ================================================================ FACE VERIFICATION
  describe('face verification', () => {
    it('verifikasi GAGAL -> request tidak dibuat sama sekali (422)', async () => {
      const res = await submit(tokens.siswaA, {
        faceImage: 'WAJAH-ORANG-LAIN',
      }).expect(422);
      expect(res.body.code).toBe('FACE_VERIFICATION_FAILED');
      expect(await count('borrow_requests')).toBe(0);
      expect(await count('borrow_request_items')).toBe(0);
      expect(await count('face_verifications')).toBe(0);
    });
    it('verifikasi gagal juga berlaku untuk barang CONSUMABLE', async () => {
      await submit(tokens.siswaA, {
        items: [{ itemTypeId: spidol.id, quantity: 1 }],
        faceImage: 'x',
      }).expect(422);
      expect(await count('borrow_requests')).toBe(0);
    });
    it('verifikasi BERHASIL -> request dibuat dan tercatat di face_verifications', async () => {
      const res = await submit(tokens.siswaA, {
        items: [{ itemTypeId: spidol.id, quantity: 1 }],
      }).expect(201);
      const rows = await ds.query(
        'SELECT user_id, request_id, status, verified_at FROM face_verifications',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        user_id: ids.siswaA,
        request_id: res.body.id,
        status: 'SUCCESS',
      });
      expect(rows[0].verified_at).not.toBeNull();
    });
    it('belum registrasi wajah -> 409 FACE_PROFILE_REQUIRED, tidak ada data dibuat', async () => {
      const res = await submit(tokens.siswaNoFace).expect(409);
      expect(res.body.code).toBe('FACE_PROFILE_REQUIRED');
      expect(await count('borrow_requests')).toBe(0);
    });
  });

  // ===================================================================== AVAILABILITY
  describe('availability', () => {
    const avail = (token: string, id: string, qs = '') =>
      as(token, http().get(`/item-types/${id}/availability${qs}`));
    const q = (s: number, e: number) =>
      `?startAt=${encodeURIComponent(slot(s, e).startAt)}&endAt=${encodeURIComponent(slot(s, e).endAt)}`;

    it('PER_UNIT: menghitung unit layak pada rentang waktu (semua role terautentikasi boleh)', async () => {
      const res = await avail(tokens.siswaA, laptop.id, q(10, 12)).expect(200);
      expect(res.body).toMatchObject({
        itemClass: 'PER_UNIT',
        totalUnits: 2,
        usableUnits: 2,
        reserved: 0,
        available: 2,
      });
      await avail(tokens.sapras, laptop.id, q(10, 12)).expect(200);
    });
    it('unit REPAIR / UNAVAILABLE / tidak layak tidak dihitung', async () => {
      await ds.query(
        `UPDATE inventory_units SET availability_status = 'REPAIR' WHERE id = $1`,
        [lpt2.id],
      );
      expect(
        (await avail(tokens.siswaA, laptop.id, q(10, 12))).body,
      ).toMatchObject({ totalUnits: 2, usableUnits: 1, available: 1 });
      await ds.query(
        `UPDATE inventory_units SET current_condition = 'PERLU_DIPERBAIKI' WHERE id = $1`,
        [lpt1.id],
      );
      expect(
        (await avail(tokens.siswaA, laptop.id, q(10, 12))).body.available,
      ).toBe(0);
    });
    it('CONSUMABLE: berdasarkan current_stock (rentang waktu tidak wajib)', async () => {
      const res = await avail(tokens.siswaA, spidol.id).expect(200);
      expect(res.body).toMatchObject({
        itemClass: 'CONSUMABLE',
        currentStock: 50,
        reserved: 0,
        available: 50,
      });
    });
    it('validasi: PER_UNIT tanpa waktu, hanya satu batas, endAt<=startAt, UUID salah, tidak ada, tanpa token', async () => {
      await avail(tokens.siswaA, laptop.id).expect(400);
      await avail(
        tokens.siswaA,
        laptop.id,
        `?startAt=${encodeURIComponent(slot(10, 12).startAt)}`,
      ).expect(400);
      await avail(tokens.siswaA, laptop.id, q(12, 10)).expect(400);
      await avail(tokens.siswaA, 'bukan-uuid', q(10, 12)).expect(400);
      await avail(
        tokens.siswaA,
        '3b241101-e2bb-4255-8caf-4136c566a962',
        q(10, 12),
      ).expect(404);
      await http()
        .get(`/item-types/${laptop.id}/availability${q(10, 12)}`)
        .expect(401);
    });
    it('request pending lain menahan kuota (soft reservation); batas waktu yang menempel tidak overlap', async () => {
      await submit(tokens.siswaA, {
        items: [{ itemTypeId: laptop.id, quantity: 2 }],
        ...slot(10, 12),
      }).expect(201);
      expect(
        (await avail(tokens.siswaB, laptop.id, q(11, 13))).body,
      ).toMatchObject({ reserved: 2, available: 0 });

      const conflict = await submit(tokens.siswaB, { ...slot(11, 13) }).expect(
        409,
      );
      expect(conflict.body.code).toBe('INSUFFICIENT_AVAILABILITY');
      expect(conflict.body.details[0]).toMatchObject({
        requested: 1,
        available: 0,
      });
      await submit(tokens.siswaB, { ...slot(12, 14) }).expect(201); // 12:00 menempel -> tidak overlap
      await submit(tokens.siswaB, {
        items: [{ itemTypeId: proyektor.id, quantity: 1 }],
        ...slot(10, 12),
      }).expect(201); // tipe lain
    });
    it('availability memakai peak concurrent demand, bukan total reservasi', async () => {
      const a = await seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 10.5));
      const b = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(11, 11.5));
      await approve(a).expect(200);
      await approve(b).expect(200);

      // A dan B sama-sama overlap window 09-12 tetapi tidak concurrent.
      const res = await avail(tokens.siswaA, laptop.id, q(9, 12)).expect(200);
      expect(res.body).toMatchObject({ reserved: 1, available: 1 });
    });

    it('availability menghitung unit fisik distinct walau ada beberapa booking', async () => {
      const start = new Date(slot(10, 11).startAt);
      const end = new Date(slot(10, 11).endAt);
      const end2 = new Date(slot(11, 12).endAt);
      const start2 = new Date(slot(11, 12).startAt);
      await seedPhysicalBooking(ids.siswaA, lpt1.id, start, end);
      await seedPhysicalBooking(ids.siswaB, lpt1.id, start2, end2);

      const res = await avail(tokens.siswaA, laptop.id, q(9, 13)).expect(200);
      expect(res.body).toMatchObject({ reserved: 1, available: 1 });
    });

    it('permintaan melebihi ketersediaan -> 409 + rincian, tidak ada data dibuat', async () => {
      const r1 = await submit(tokens.siswaA, {
        items: [{ itemTypeId: laptop.id, quantity: 3 }],
      }).expect(409);
      expect(r1.body.details[0]).toMatchObject({
        name: 'Laptop',
        requested: 3,
        available: 2,
      });
      await submit(tokens.siswaA, {
        items: [{ itemTypeId: spidol.id, quantity: 51 }],
      }).expect(409);
      expect(await count('borrow_requests')).toBe(0);
    });
    it('keranjang campuran: satu item kurang -> seluruh request ditolak', async () => {
      await submit(tokens.siswaA, {
        items: [
          { itemTypeId: laptop.id, quantity: 1 },
          { itemTypeId: spidol.id, quantity: 999 },
        ],
      }).expect(409);
      expect(await count('borrow_requests')).toBe(0);
    });
    it('request yang sudah lewat 2 jam tidak lagi menahan kuota', async () => {
      await seedPending(
        ids.siswaB,
        [{ type: laptop, qty: 2 }],
        slot(10, 12),
        121,
      );
      expect(
        (await avail(tokens.siswaA, laptop.id, q(10, 12))).body.available,
      ).toBe(2);
    });
  });

  // ===================================================================== APPROVAL
  describe('approval Sapras', () => {
    it('APPROVE hanya mengunci kapasitas: status APPROVED, booking NULL per unit diminta', async () => {
      const created = await submit(tokens.siswaA, { items: [{ itemTypeId: laptop.id, quantity: 2 }] }).expect(201);
      const res = await approve(created.body.id).expect(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.bookings).toHaveLength(2);
      expect(res.body.bookings.every((b: { inventoryUnit: unknown }) => b.inventoryUnit === null)).toBe(true);
      const rows = await ds.query(`SELECT inventory_unit_id, expires_at FROM item_bookings WHERE request_id = $1`, [created.body.id]);
      expect(rows).toHaveLength(2);
      expect(rows.every((r: { inventory_unit_id: string | null }) => r.inventory_unit_id === null)).toBe(true);
      expect(new Date(rows[0].expires_at).toISOString()).toBe(new Date(created.body.approvalDeadline).toISOString());
      expect((await ds.getRepository(InventoryUnit).find()).every((u) => u.availabilityStatus === 'AVAILABLE')).toBe(true);
    });

    it('APPROVE menolak assignments lama; unit fisik dipilih saat handover', async () => {
      const created = await submit(tokens.siswaA).expect(201);
      await approve(created.body.id, { assignments: [{ requestItemId: created.body.items[0].id, inventoryUnitIds: [lpt2.id] }] }).expect(400);
      const res = await approve(created.body.id, {}).expect(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.bookings[0].inventoryUnit).toBeNull();
    });

    it('approval gagal jika kapasitas waktu tidak cukup', async () => {
      const a = await seedPending(ids.siswaA, [{ type: laptop, qty: 2 }], slot(10, 12));
      await approve(a).expect(200);
      const b = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(10, 12));
      const conflict = await approve(b).expect(409);
      expect(conflict.body.code).toBe('INSUFFICIENT_AVAILABILITY');
      expect(await requestStatus(b)).toBe('WAITING_APPROVAL');
    });

    it('REJECT: status REJECTED, tidak ada booking; tidak bisa diproses lagi', async () => {
      const created = await submit(tokens.siswaA).expect(201);
      const res = await reject(created.body.id).expect(200);
      expect(res.body.status).toBe('REJECTED');
      expect(await count('item_bookings')).toBe(0);
      expect((await approve(created.body.id).expect(409)).body.code).toBe('INVALID_STATUS');
      await reject(created.body.id).expect(409);
    });

    it('request yang sudah APPROVED tidak dapat di-approve/reject lagi', async () => {
      const created = await submit(tokens.siswaA).expect(201);
      await approve(created.body.id).expect(200);
      await approve(created.body.id).expect(409);
      await reject(created.body.id).expect(409);
      expect(await count('item_bookings')).toBe(1);
    });

    it('otorisasi: siswa/guru/admin tidak boleh approve/reject; tanpa token 401; id invalid 400; tidak ada 404', async () => {
      const created = await submit(tokens.siswaA).expect(201);
      const id = created.body.id;
      for (const t of [tokens.siswaA, tokens.siswaB, tokens.guru, tokens.admin]) {
        await as(t, http().post(`/borrow-requests/${id}/approve`)).send({}).expect(403);
        await as(t, http().post(`/borrow-requests/${id}/reject`)).expect(403);
      }
      await http().post(`/borrow-requests/${id}/approve`).send({}).expect(401);
      await approve('bukan-uuid').expect(400);
      await approve('3b241101-e2bb-4255-8caf-4136c566a962').expect(404);
      expect((await ds.getRepository(BorrowRequest).findOneByOrFail({ id })).status).toBe('WAITING_APPROVAL');
    });

    it('approval tidak mengubah status fisik unit dan tidak membuat handover/return', async () => {
      const created = await submit(tokens.siswaA).expect(201);
      await approve(created.body.id).expect(200);
      expect((await ds.getRepository(InventoryUnit).find()).every((u) => u.availabilityStatus === 'AVAILABLE')).toBe(true);
      expect(await count('handover_records')).toBe(0);
      expect(await count('return_records')).toBe(0);
    });
  });

  // ===================================================================== DEADLINE 2 JAM
  describe('batas waktu approval 2 jam', () => {
    it('masih dalam 2 jam (119 menit) -> dapat di-approve', async () => {
      const id = await seedPending(
        ids.siswaA,
        [{ type: laptop, qty: 1 }],
        slot(10, 12),
        119,
      );
      await approve(id).expect(200);
    });
    it('masih dalam 2 jam -> dapat di-reject', async () => {
      const id = await seedPending(
        ids.siswaA,
        [{ type: laptop, qty: 1 }],
        slot(10, 12),
        119,
      );
      await reject(id).expect(200);
    });
    it('lewat 2 jam (121 menit) -> approve ditolak 409 REQUEST_EXPIRED dan status menjadi EXPIRED', async () => {
      const id = await seedPending(
        ids.siswaA,
        [{ type: laptop, qty: 1 }],
        slot(10, 12),
        121,
      );
      const res = await approve(id).expect(409);
      expect(res.body.code).toBe('REQUEST_EXPIRED');
      expect(
        (await ds.getRepository(BorrowRequest).findOneByOrFail({ id })).status,
      ).toBe('EXPIRED');
      expect(await count('item_bookings')).toBe(0);
      expect((await reject(id).expect(409)).body.code).toBe('REQUEST_EXPIRED');
    });
    it('deadline dievaluasi pada saat approve walau belum disapu (lazy + di dalam transaksi)', async () => {
      const created = await submit(tokens.siswaA).expect(201);
      await backdate(created.body.id, 125);
      await approve(created.body.id).expect(409);
      expect(
        (
          await ds
            .getRepository(BorrowRequest)
            .findOneByOrFail({ id: created.body.id })
        ).status,
      ).toBe('EXPIRED');
    });
    it('GET menampilkan EXPIRED; antrean /pending hanya berisi yang belum lewat deadline', async () => {
      const fresh = await submit(tokens.siswaA).expect(201);
      const stale = await submit(tokens.siswaB, {
        items: [{ itemTypeId: proyektor.id, quantity: 1 }],
      }).expect(201);
      await backdate(stale.body.id, 130);

      const view = await as(
        tokens.siswaB,
        http().get(`/borrow-requests/${stale.body.id}`),
      ).expect(200);
      expect(view.body.status).toBe('EXPIRED');

      const pending = await as(
        tokens.sapras,
        http().get('/borrow-requests/pending'),
      ).expect(200);
      expect(pending.body.data.map((r: { id: string }) => r.id)).toEqual([
        fresh.body.id,
      ]);
      expect(pending.body.data[0].approvalDeadline).toBeDefined();
    });
    it('request EXPIRED tidak dapat dibatalkan', async () => {
      const id = await seedPending(
        ids.siswaA,
        [{ type: laptop, qty: 1 }],
        slot(10, 12),
        121,
      );
      const res = await as(
        tokens.siswaA,
        http().post(`/borrow-requests/${id}/cancel`),
      ).expect(409);
      expect(res.body.code).toBe('REQUEST_EXPIRED');
    });
    it('sapuan expiry mengubah status di database', async () => {
      const { BorrowExpiryService } =
        await import('../src/borrowings/borrow-expiry.service');
      const id = await seedPending(
        ids.siswaA,
        [{ type: laptop, qty: 1 }],
        slot(10, 12),
        200,
      );
      const fresh = await seedPending(
        ids.siswaA,
        [{ type: proyektor, qty: 1 }],
        slot(10, 12),
        10,
      );
      expect(await app.get(BorrowExpiryService).expireOverdue()).toBe(1);
      expect(
        (await ds.getRepository(BorrowRequest).findOneByOrFail({ id })).status,
      ).toBe('EXPIRED');
      expect(
        (await ds.getRepository(BorrowRequest).findOneByOrFail({ id: fresh }))
          .status,
      ).toBe('WAITING_APPROVAL');
    });
  });

  // ===================================================================== NO-SHOW 30 MENIT
  describe('no-show 30 menit', () => {
    const start = new Date('2030-01-01T08:00:00.000Z');

    it('08:29:59 masih APPROVED dan booking belum dilepas', async () => {
      const req = await seedApproved(ids.siswaA, start);
      expect(await sweep(new Date('2030-01-01T08:29:59.000Z'))).toBe(0);
      expect(await requestStatus(req.id)).toBe('APPROVED');
      expect(await bookingStatus(req.bookingId)).toBe('APPROVED');
    });

    it('08:30:00 tepat di batas -> EXPIRED dan booking dilepas (TANPA handover)', async () => {
      const req = await seedApproved(ids.siswaA, start);
      expect(await sweep(new Date('2030-01-01T08:30:00.000Z'))).toBe(1);
      expect(await requestStatus(req.id)).toBe('EXPIRED');
      expect(await bookingStatus(req.bookingId)).toBe('EXPIRED');

      // expires_at booking TETAP created_at + 2 jam (bukan start_at + 30 menit).
      const row = await ds.query(
        `SELECT b.expires_at, r.created_at
         FROM item_bookings b JOIN borrow_requests r ON r.id = b.request_id
         WHERE b.id = $1`,
        [req.bookingId],
      );
      expect(
        new Date(row[0].expires_at).getTime() -
          new Date(row[0].created_at).getTime(),
      ).toBe(2 * HOUR);
    });

    it('08:30:01 -> EXPIRED', async () => {
      const req = await seedApproved(ids.siswaA, start);
      expect(await sweep(new Date('2030-01-01T08:30:01.000Z'))).toBe(1);
      expect(await requestStatus(req.id)).toBe('EXPIRED');
    });

    it('handover sudah tercatat -> TIDAK expire sebagai no-show', async () => {
      const req = await seedApproved(ids.siswaA, start, { handover: true });
      expect(await sweep(new Date('2030-01-01T09:30:00.000Z'))).toBe(0);
      expect(await requestStatus(req.id)).toBe('APPROVED');
      expect(await bookingStatus(req.bookingId)).toBe('APPROVED');
    });

    it('future booking: Jumat APPROVED, Sabtu 08:29:59 APPROVED, Sabtu 08:30:00 EXPIRED', async () => {
      const sabtu = new Date('2030-01-05T08:00:00.000Z');
      const req = await seedApproved(ids.siswaA, sabtu);

      expect(await sweep(new Date('2030-01-04T10:00:00.000Z'))).toBe(0); // Jumat
      expect(await requestStatus(req.id)).toBe('APPROVED');
      expect(await sweep(new Date('2030-01-05T08:29:59.000Z'))).toBe(0); // Sabtu sebelum batas
      expect(await requestStatus(req.id)).toBe('APPROVED');
      expect(await sweep(new Date('2030-01-05T08:30:00.000Z'))).toBe(1); // tepat batas
      expect(await requestStatus(req.id)).toBe('EXPIRED');
    });

    it('request yang sudah EXPIRED tidak diproses ulang (idempotent)', async () => {
      const req = await seedApproved(ids.siswaA, start);
      expect(await sweep(new Date('2030-01-01T09:00:00.000Z'))).toBe(1);
      expect(await sweep(new Date('2030-01-01T09:05:00.000Z'))).toBe(0);
      expect(await requestStatus(req.id)).toBe('EXPIRED');
    });
  });

  // ===================================================================== BOOKING
  describe('booking & konflik waktu', () => {
    it('approval menggunakan kapasitas, bukan memilih unit fisik', async () => {
      const a = await seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 12));
      const b = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(10, 12));
      const c = await seedPending(ids.guru, [{ type: laptop, qty: 1 }], slot(10, 12));
      await approve(a).expect(200);
      await approve(b).expect(200);
      const conflict = await approve(c).expect(409);
      expect(conflict.body.code).toBe('INSUFFICIENT_AVAILABILITY');
      expect(await count('item_bookings')).toBe(2);
      const rows = await ds.query(`SELECT inventory_unit_id FROM item_bookings ORDER BY created_at`);
      expect(rows).toHaveLength(2);
      expect(rows.every((r: { inventory_unit_id: string | null }) => r.inventory_unit_id === null)).toBe(true);
    });

    it('slot waktu yang tidak overlap tetap dapat di-approve walau kapasitas slot sebelumnya penuh', async () => {
      const a = await seedPending(ids.siswaA, [{ type: laptop, qty: 2 }], slot(10, 12));
      const b = await seedPending(ids.siswaB, [{ type: laptop, qty: 2 }], slot(12, 14));
      await approve(a).expect(200);
      await approve(b).expect(200);
      expect(await count('item_bookings')).toBe(4);
    });

    it('dua approval bersamaan untuk dua unit berhasil tanpa memilih unit fisik', async () => {
      const a = await seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 12));
      const b = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(10, 12));
      const [ra, rb] = await Promise.all([approve(a), approve(b)]);
      expect([ra.status, rb.status].sort()).toEqual([200, 200]);
      const rows = await ds.query(`SELECT inventory_unit_id FROM item_bookings WHERE request_id IN ($1, $2)`, [a, b]);
      expect(rows).toHaveLength(2);
      expect(rows.every((r: { inventory_unit_id: string | null }) => r.inventory_unit_id === null)).toBe(true);
    });
  });

  // ============================================== KAPASITAS: PEAK & DISTINCT UNIT
  describe('kapasitas: peak concurrent demand dan unit fisik distinct', () => {
    const windowOf = (from: number, to: number) => ({
      start: new Date(slot(from, to).startAt),
      end: new Date(slot(from, to).endAt),
    });

    it('reservasi generic non-overlap tidak dijumlahkan (peak, bukan total)', async () => {
      const a = await seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 10.5));
      const b = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(11, 11.5));
      await approve(a).expect(200);
      await approve(b).expect(200);

      // C membentang kedua slot, tetapi A dan B tidak concurrent.
      // Kapasitas 2 unit -> satu unit masih bebas untuk seluruh window C.
      const c = await seedPending(ids.guru, [{ type: laptop, qty: 1 }], slot(9, 12));
      await approve(c).expect(200);
      expect(await count('item_bookings')).toBe(3);
    });

    it('reservasi generic overlap dihitung bersamaan -> 409', async () => {
      const a = await seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 12));
      const b = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(11, 13));
      await approve(a).expect(200);
      await approve(b).expect(200);

      const c = await seedPending(ids.guru, [{ type: laptop, qty: 1 }], slot(10, 13));
      const conflict = await approve(c).expect(409);
      expect(conflict.body.code).toBe('INSUFFICIENT_AVAILABILITY');
    });

    it('exact boundary: booking berakhir tepat saat booking lain mulai tidak overlap', async () => {
      const a = await seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 11));
      const b = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(11, 12));
      await approve(a).expect(200);
      await approve(b).expect(200);

      const c = await seedPending(ids.guru, [{ type: laptop, qty: 1 }], slot(10, 12));
      await approve(c).expect(200);
    });

    it('unit fisik yang sama dengan beberapa booking hanya dihitung sekali', async () => {
      const { start: s1, end: e1 } = windowOf(10, 11);
      const { start: s2, end: e2 } = windowOf(11, 12);
      await seedPhysicalBooking(ids.siswaA, lpt1.id, s1, e1);
      await seedPhysicalBooking(ids.siswaB, lpt1.id, s2, e2);

      // lpt1 terpakai di dua slot, tetapi tetap satu unit. lpt2 bebas penuh.
      const c = await seedPending(ids.guru, [{ type: laptop, qty: 1 }], slot(9, 13));
      await approve(c).expect(200);
    });

    it('unit fisik berbeda yang overlap -> kapasitas penuh', async () => {
      const { start, end } = windowOf(10, 12);
      await seedPhysicalBooking(ids.siswaA, lpt1.id, start, end);
      await seedPhysicalBooking(ids.siswaB, lpt2.id, start, end);

      const c = await seedPending(ids.guru, [{ type: laptop, qty: 1 }], slot(10, 12));
      const conflict = await approve(c).expect(409);
      expect(conflict.body.code).toBe('INSUFFICIENT_AVAILABILITY');
    });

    it('mixed generic + physical booking tidak double count', async () => {
      const { start, end } = windowOf(10, 12);
      await seedPhysicalBooking(ids.siswaA, lpt1.id, start, end);
      const generic = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(10, 12));
      await approve(generic).expect(200);

      // lpt1 (fisik) + 1 reservasi generic = 2 unit, kapasitas habis.
      const c = await seedPending(ids.guru, [{ type: laptop, qty: 1 }], slot(10, 12));
      const conflict = await approve(c).expect(409);
      expect(conflict.body.code).toBe('INSUFFICIENT_AVAILABILITY');
    });

    it('booking EXPIRED/RELEASED tidak memblokir kapasitas', async () => {
      const { start, end } = windowOf(10, 12);
      const physical = await seedPhysicalBooking(
        ids.siswaA,
        lpt1.id,
        start,
        end,
        BookingStatus.EXPIRED,
      );
      void physical;
      const generic = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(10, 12));
      await approve(generic).expect(200);
      await ds.query(
        `UPDATE item_bookings SET status = 'EXPIRED' WHERE request_id = $1`,
        [generic],
      );

      const c = await seedPending(ids.guru, [{ type: laptop, qty: 2 }], slot(10, 12));
      await approve(c).expect(200);
    });

    it('request yang tepat menghabiskan kapasitas berhasil, melebihi kapasitas ditolak', async () => {
      const a = await seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 11));
      const b = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(11, 12));
      await approve(a).expect(200);
      await approve(b).expect(200);

      // Peak = 1, tetapi request 2 unit butuh 2 unit yang bebas pada window yang sama.
      const tooMany = await seedPending(ids.guru, [{ type: laptop, qty: 2 }], slot(9, 13));
      await approve(tooMany).expect(409);

      const exact = await seedPending(ids.guru, [{ type: laptop, qty: 1 }], slot(9, 13));
      await approve(exact).expect(200);
    });
  });

  // ===================================================================== CONCURRENCY
  describe('concurrency: reservasi kapasitas tidak boleh double count', () => {
    it('dua approval bersamaan untuk kapasitas dua unit -> keduanya berhasil', async () => {
      for (let round = 0; round < 3; round++) {
        await ds.query('TRUNCATE TABLE item_bookings, borrow_request_items, borrow_requests RESTART IDENTITY CASCADE');
        const a = await seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 12));
        const b = await seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(10, 12));
        const [ra, rb] = await Promise.all([approve(a), approve(b)]);
        expect([ra.status, rb.status].sort()).toEqual([200, 200]);
        expect(await count('item_bookings')).toBe(2);
      }
    });

    it('tiga approval bersamaan untuk kapasitas dua unit -> tepat dua berhasil', async () => {
      await ds.query('TRUNCATE TABLE item_bookings, borrow_request_items, borrow_requests RESTART IDENTITY CASCADE');
      const idsPending = await Promise.all([
        seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 12)),
        seedPending(ids.siswaB, [{ type: laptop, qty: 1 }], slot(10, 12)),
        seedPending(ids.guru, [{ type: laptop, qty: 1 }], slot(10, 12)),
      ]);
      const results = await Promise.all(idsPending.map((id) => approve(id)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 409]);
      expect(await count('item_bookings')).toBe(2);
    });

    it('request yang sama di-approve bersamaan -> hanya satu yang memproses', async () => {
      const id = await seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 12));
      const results = await Promise.all([approve(id), approve(id), approve(id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(await count('item_bookings')).toBe(1);
    });

    it('approve dan reject bersamaan pada request yang sama -> satu pemenang, status konsisten', async () => {
      const id = await seedPending(ids.siswaA, [{ type: laptop, qty: 1 }], slot(10, 12));
      const [ra, rj] = await Promise.all([approve(id), reject(id)]);
      expect([ra.status, rj.status].sort()).toEqual([200, 409]);
      const status = (await ds.getRepository(BorrowRequest).findOneByOrFail({ id })).status;
      expect(await count('item_bookings')).toBe(status === 'APPROVED' ? 1 : 0);
    });
  });

  // ===================================================================== CONSUMABLE
  describe('consumable', () => {
    it('stok mencukupi -> request dapat disetujui TANPA mengurangi stok dan TANPA STOCK_OUT', async () => {
      const created = await submit(tokens.siswaA, {
        items: [{ itemTypeId: spidol.id, quantity: 10 }],
      }).expect(201);
      const res = await approve(created.body.id).expect(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.bookings).toEqual([]); // consumable tidak punya unit fisik / booking
      expect(
        (
          await ds
            .getRepository(ConsumableStock)
            .findOneByOrFail({ itemTypeId: spidol.id })
        ).currentStock,
      ).toBe(50);
      expect(await count('stock_movements')).toBe(0);
      expect(await count('item_bookings')).toBe(0);
    });

    it('stok tidak mencukupi -> ditolak saat submit (409) dan saat approve (409)', async () => {
      await submit(tokens.siswaA, {
        items: [{ itemTypeId: spidol.id, quantity: 51 }],
      }).expect(409);
      const id = await seedPending(
        ids.siswaA,
        [{ type: spidol, qty: 60 }],
        slot(10, 12),
      );
      const res = await approve(id).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_AVAILABILITY');
      expect(
        (await ds.getRepository(BorrowRequest).findOneByOrFail({ id })).status,
      ).toBe('WAITING_APPROVAL');
      expect(await count('stock_movements')).toBe(0);
    });

    it('stok yang sudah dijanjikan ke request APPROVED lain dihitung (belum dipotong sampai handover)', async () => {
      await ds.query(`UPDATE consumable_stocks SET current_stock = 10`);
      const x = await seedPending(
        ids.siswaA,
        [{ type: spidol, qty: 8 }],
        slot(10, 12),
      );
      const y = await seedPending(
        ids.siswaB,
        [{ type: spidol, qty: 5 }],
        slot(10, 12),
      );
      await approve(x).expect(200);
      await approve(y).expect(409); // 10 - 8 (dijanjikan) = 2 < 5
      await as(
        tokens.siswaA,
        http().post(`/borrow-requests/${x}/cancel`),
      ).expect(200);
      await approve(y).expect(200); // komitmen dilepas
      expect(await count('stock_movements')).toBe(0);
    });

    it('item consumable yang belum punya baris stok -> tidak tersedia', async () => {
      await ds.query('DELETE FROM consumable_stocks');
      await submit(tokens.siswaA, {
        items: [{ itemTypeId: spidol.id, quantity: 1 }],
      }).expect(409);
      await ds
        .getRepository(ConsumableStock)
        .save({ itemTypeId: spidol.id, currentStock: 50, minimumStock: 5 });
    });
  });

  // ===================================================================== CANCEL
  describe('cancel', () => {
    it('pemilik dapat membatalkan request WAITING_APPROVAL', async () => {
      const created = await submit(tokens.siswaA).expect(201);
      const res = await as(
        tokens.siswaA,
        http().post(`/borrow-requests/${created.body.id}/cancel`),
      ).expect(200);
      expect(res.body.status).toBe('CANCELLED');
    });
    it('bukan pemilik -> 404; Sapras/Admin tidak boleh membatalkan -> 403; sudah CANCELLED/REJECTED -> 409', async () => {
      const created = await submit(tokens.siswaA).expect(201);
      const url = `/borrow-requests/${created.body.id}/cancel`;
      await as(tokens.siswaB, http().post(url)).expect(404);
      await as(tokens.sapras, http().post(url)).expect(403);
      await as(tokens.admin, http().post(url)).expect(403);
      await http().post(url).expect(401);
      await as(tokens.siswaA, http().post(url)).expect(200);
      await as(tokens.siswaA, http().post(url)).expect(409);

      const rejected = await submit(tokens.siswaA).expect(201);
      await reject(rejected.body.id).expect(200);
      await as(
        tokens.siswaA,
        http().post(`/borrow-requests/${rejected.body.id}/cancel`),
      ).expect(409);
    });
    it('request yang sudah dibatalkan tidak bisa di-approve', async () => {
      const created = await submit(tokens.siswaA).expect(201);
      await as(
        tokens.siswaA,
        http().post(`/borrow-requests/${created.body.id}/cancel`),
      ).expect(200);
      await approve(created.body.id).expect(409);
    });
  });

  // ===================================================================== OWNERSHIP
  describe('kepemilikan data', () => {
    it('siswa hanya melihat request miliknya; request siswa lain 404', async () => {
      const a = await submit(tokens.siswaA).expect(201);
      const g = await submit(tokens.guru, {
        items: [{ itemTypeId: proyektor.id, quantity: 1 }],
      }).expect(201);

      const listA = await as(
        tokens.siswaA,
        http().get('/borrow-requests'),
      ).expect(200);
      expect(listA.body.data.map((r: { id: string }) => r.id)).toEqual([
        a.body.id,
      ]);
      expect(
        (await as(tokens.siswaB, http().get('/borrow-requests')).expect(200))
          .body.data,
      ).toEqual([]);

      await as(
        tokens.siswaB,
        http().get(`/borrow-requests/${a.body.id}`),
      ).expect(404);
      await as(
        tokens.siswaA,
        http().get(`/borrow-requests/${g.body.id}`),
      ).expect(404);
      await as(
        tokens.siswaA,
        http().get(`/borrow-requests/${a.body.id}`),
      ).expect(200);
      await as(tokens.siswaA, http().get('/borrow-requests/pending')).expect(
        403,
      );
    });
    it('Sapras melihat semua request; Admin tidak punya akses; tanpa token 401', async () => {
      await submit(tokens.siswaA).expect(201);
      await submit(tokens.guru, {
        items: [{ itemTypeId: proyektor.id, quantity: 1 }],
      }).expect(201);
      const all = await as(
        tokens.sapras,
        http().get('/borrow-requests'),
      ).expect(200);
      expect(all.body.meta.total).toBe(2);
      await as(tokens.admin, http().get('/borrow-requests')).expect(403);
      await http().get('/borrow-requests').expect(401);
      await as(tokens.sapras, http().get('/borrow-requests/bukan-uuid')).expect(
        400,
      );
      await as(
        tokens.sapras,
        http().get('/borrow-requests/3b241101-e2bb-4255-8caf-4136c566a962'),
      ).expect(404);
    });
    it('filter status & pagination', async () => {
      const a = await submit(tokens.siswaA).expect(201);
      await submit(tokens.siswaA, {
        items: [{ itemTypeId: proyektor.id, quantity: 1 }],
      }).expect(201);
      await reject(a.body.id).expect(200);
      const rej = await as(
        tokens.siswaA,
        http().get('/borrow-requests?status=REJECTED'),
      ).expect(200);
      expect(rej.body.data).toHaveLength(1);
      const page = await as(
        tokens.siswaA,
        http().get('/borrow-requests?limit=1&page=2'),
      ).expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta).toMatchObject({
        total: 2,
        page: 2,
        limit: 1,
        totalPages: 2,
      });
      await as(
        tokens.siswaA,
        http().get('/borrow-requests?status=SALAH'),
      ).expect(400);
      await as(tokens.siswaA, http().get('/borrow-requests?limit=500')).expect(
        400,
      );
    });
    it('Sapras melihat identitas peminjam; antrean pending terurut dari yang terlama', async () => {
      const first = await submit(tokens.siswaA).expect(201);
      await new Promise((r) => setTimeout(r, 15));
      await submit(tokens.guru, {
        items: [{ itemTypeId: proyektor.id, quantity: 1 }],
      }).expect(201);
      const pending = await as(
        tokens.sapras,
        http().get('/borrow-requests/pending'),
      ).expect(200);
      expect(pending.body.data[0].id).toBe(first.body.id);
      expect(pending.body.data[0].requester).toMatchObject({
        name: 'Siswa A',
        nis: '1001',
        className: 'X-A',
      });
    });
  });

  // ===================================================================== FLOW LENGKAP
  describe('alur lengkap end-to-end', () => {
    it('login -> availability -> submit + face -> pending -> Sapras approve -> approved & unit fisik belum dipilih', async () => {
      const login = await http()
        .post('/auth/login')
        .send({ identifier: '1001', password: 'Password123' })
        .expect(200);
      const token = login.body.accessToken as string;
      const win = slot(9, 11);

      const av = await as(
        token,
        http().get(
          `/item-types/${laptop.id}/availability?startAt=${encodeURIComponent(win.startAt)}&endAt=${encodeURIComponent(win.endAt)}`,
        ),
      ).expect(200);
      expect(av.body.available).toBe(2);

      const created = await as(token, http().post('/borrow-requests'))
        .send(
          body({
            items: [
              { itemTypeId: laptop.id, quantity: 1 },
              { itemTypeId: spidol.id, quantity: 5 },
            ],
            ...win,
          }),
        )
        .expect(201);
      expect(created.body.status).toBe('WAITING_APPROVAL');

      const sapras = await http()
        .post('/auth/login')
        .send({ identifier: 'sapras@sekolah.id', password: 'Password123' })
        .expect(200);
      const st = sapras.body.accessToken as string;
      const pending = await as(
        st,
        http().get('/borrow-requests/pending'),
      ).expect(200);
      expect(pending.body.data.map((r: { id: string }) => r.id)).toContain(
        created.body.id,
      );

      await as(st, http().post(`/borrow-requests/${created.body.id}/approve`))
        .send({})
        .expect(200);

      const mine = await as(
        token,
        http().get(`/borrow-requests/${created.body.id}`),
      ).expect(200);
      expect(mine.body.status).toBe('APPROVED');
      expect(mine.body.bookings).toHaveLength(1); // hanya laptop; spidol tidak punya unit
      expect(mine.body.bookings[0].inventoryUnit).toBeNull();

      // kompatibel dengan Sprint 9: belum ada handover, request_id handover_records masih bebas
      expect(await count('handover_records')).toBe(0);
      expect(
        mine.body.items.find(
          (i: { itemType: { name: string } }) => i.itemType.name === 'Spidol',
        ).quantityHandedOver,
      ).toBeNull();
    });
  });
});
