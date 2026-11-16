import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { BorrowExpiryService } from '../src/borrowings/borrow-expiry.service';
import { BorrowRequestItem } from '../src/borrowings/entities/borrow-request-item.entity';
import { BorrowRequest } from '../src/borrowings/entities/borrow-request.entity';
import { ItemBooking } from '../src/borrowings/entities/item-booking.entity';
import {
  AvailabilityStatus,
  BookingStatus,
  BorrowRequestStatus,
  ItemClass,
  ItemCondition,
  StockMovementType,
  UserRole,
} from '../src/common/enums';
import { ConsumableStock } from '../src/inventory/entities/consumable-stock.entity';
import { InventoryUnit } from '../src/inventory/entities/inventory-unit.entity';
import { ItemCategory } from '../src/master-data/entities/item-category.entity';
import { ItemType } from '../src/master-data/entities/item-type.entity';
import { Location } from '../src/master-data/entities/location.entity';
import { RepairRecord } from '../src/repairs/entities/repair-record.entity';
import { StockMovement } from '../src/stock/entities/stock-movement.entity';
import { createTestApp, loginAs, resetDatabase, seedUser } from './utils/test-app';

const HOUR = 3600_000;

interface Line {
  type: ItemType;
  quantity: number;
  units?: InventoryUnit[];
}

describe('Handover & return (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tokens: { siswa: string; sapras: string; admin: string };
  let siswaId: string;
  let laptop: ItemType;
  let proyektor: ItemType;
  let spidol: ItemType;
  let lpt1: InventoryUnit;
  let lpt2: InventoryUnit;
  let prj1: InventoryUnit;

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  const count = async (table: string) =>
    Number((await ds.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n);
  const stockOf = async (type: ItemType) =>
    (await ds.getRepository(ConsumableStock).findOneByOrFail({
      itemTypeId: type.id,
    })).currentStock;
  const requestStatus = async (id: string) =>
    (await ds.getRepository(BorrowRequest).findOneByOrFail({ id })).status;

  function seedRequest(
    status: BorrowRequestStatus,
    lines: Line[],
    options: { startAt?: Date; endAt?: Date } = {},
  ): Promise<{ request: BorrowRequest; items: BorrowRequestItem[] }> {
    return ds.transaction(async (manager) => {
      const startAt = options.startAt ?? new Date(Date.now() + HOUR);
      const endAt = options.endAt ?? new Date(startAt.getTime() + 2 * HOUR);
      const request = await manager.save(
        manager.create(BorrowRequest, {
          userId: siswaId,
          requestCode: `BR-E2E-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          startAt,
          endAt,
          purpose: 'Praktikum',
          status,
        }),
      );
      const items: BorrowRequestItem[] = [];
      for (const line of lines) {
        const item = await manager.save(
          manager.create(BorrowRequestItem, {
            requestId: request.id,
            itemTypeId: line.type.id,
            quantityRequested: line.quantity,
          }),
        );
        items.push(item);
        for (const _unit of line.units ?? []) {
          await manager.save(
            manager.create(ItemBooking, {
              inventoryUnitId: null,
              requestId: request.id,
              startAt,
              endAt,
              status: BookingStatus.APPROVED,
              expiresAt: new Date(request.createdAt.getTime() + 2 * HOUR),
            }),
          );
        }
      }
      return { request, items };
    });
  }

  const handover = (requestId: string, selections?: Array<Record<string, unknown>>, notes?: string) =>
    as(tokens.sapras, http().post('/handovers')).send({
      requestId,
      ...(selections ? { selections } : {}),
      ...(notes ? { notes } : {}),
    });
  const receive = (requestId: string, items: Array<Record<string, unknown>>) =>
    as(tokens.sapras, http().post('/returns')).send({ requestId, items });

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    await resetDatabase(app);

    const siswa = await seedUser(app, {
      role: UserRole.SISWA,
      name: 'Siswa',
      nis: '2001',
      className: 'XI-A',
    });
    siswaId = siswa.id;
    await seedUser(app, { role: UserRole.SAPRAS, email: 'sapras2@sekolah.id' });
    await seedUser(app, { role: UserRole.ADMIN, email: 'admin2@sekolah.id' });

    const category = await ds
      .getRepository(ItemCategory)
      .save({ name: 'Elektronik' });
    const location = await ds.getRepository(Location).save({ name: 'Gudang' });
    const mk = (name: string, itemClass: ItemClass, unitName: string) =>
      ds
        .getRepository(ItemType)
        .save({ categoryId: category.id, name, itemClass, unitName });
    laptop = await mk('Laptop', ItemClass.PER_UNIT, 'unit');
    proyektor = await mk('Proyektor', ItemClass.PER_UNIT, 'unit');
    spidol = await mk('Spidol', ItemClass.CONSUMABLE, 'pcs');
    const unit = (type: ItemType, code: string) =>
      ds.getRepository(InventoryUnit).save({
        itemTypeId: type.id,
        locationId: location.id,
        inventoryCode: code,
        barcode: `BC-${code}`,
      });
    lpt1 = await unit(laptop, 'LPT-101');
    lpt2 = await unit(laptop, 'LPT-102');
    prj1 = await unit(proyektor, 'PRJ-101');
    await ds
      .getRepository(ConsumableStock)
      .save({ itemTypeId: spidol.id, currentStock: 50, minimumStock: 5 });

    tokens = {
      siswa: await loginAs(app, '2001'),
      sapras: await loginAs(app, 'sapras2@sekolah.id'),
      admin: await loginAs(app, 'admin2@sekolah.id'),
    };
  });

  afterAll(async () => app.close());

  beforeEach(async () => {
    await ds.query(
      `TRUNCATE TABLE return_items, return_records, handover_items, handover_records,
        repair_records, stock_movements, item_bookings, borrow_request_items, borrow_requests
        RESTART IDENTITY CASCADE`,
    );
    await ds.query(`UPDATE consumable_stocks SET current_stock = 50`);
    await ds.query(
      `UPDATE inventory_units SET availability_status = 'AVAILABLE', current_condition = 'LAYAK_PAKAI'`,
    );
  });

  // ============================================================== HANDOVER
  describe('handover', () => {
    it('request APPROVED dapat diserahkan memakai unit yang di-booking', async () => {
      const { request } = await seedRequest(BorrowRequestStatus.APPROVED, [
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);

      const res = await handover(request.id, [{ requestItemId: (await ds.getRepository(BorrowRequestItem).findOneByOrFail({ requestId: request.id })).id, inventoryUnitIds: [lpt1.id] }]).expect(201);
      expect(res.body.requestId).toBe(request.id);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        inventoryUnitId: lpt1.id,
        quantityHandedOver: 1,
      });

      expect(await requestStatus(request.id)).toBe(
        BorrowRequestStatus.HANDED_OVER,
      );
      const unit = await ds
        .getRepository(InventoryUnit)
        .findOneByOrFail({ id: lpt1.id });
      expect(unit.availabilityStatus).toBe(AvailabilityStatus.BORROWED);
      // Booking tetap APPROVED (memblokir periode) sampai barang kembali.
      expect(
        (await ds.getRepository(ItemBooking).findOneByOrFail({
          requestId: request.id,
        })).status,
      ).toBe(BookingStatus.APPROVED);
    });

    it('inline no-show: request EXPIRED dan ItemBooking dilepas sehingga kapasitas tidak terblokir', async () => {
      const startAt = new Date(Date.now() - 31 * 60 * 1000);
      const endAt = new Date(startAt.getTime() + 2 * HOUR);
      const { request, items } = await seedRequest(
        BorrowRequestStatus.APPROVED,
        [{ type: laptop, quantity: 1, units: [lpt1] }],
        { startAt, endAt },
      );

      // Paksa branch inline di dalam transaksi handover (sapuan lazy dimatikan)
      // agar release booking benar-benar diuji, bukan hanya jalur sweep.
      const expiry = app.get(BorrowExpiryService);
      const spy = jest
        .spyOn(expiry, 'expireOverdue')
        .mockResolvedValueOnce(0);
      try {
        const res = await handover(request.id, [
          { requestItemId: items[0].id, inventoryUnitIds: [lpt1.id] },
        ]).expect(409);
        expect(res.body.code).toBe('REQUEST_EXPIRED');
      } finally {
        spy.mockRestore();
      }

      expect(await requestStatus(request.id)).toBe(BorrowRequestStatus.EXPIRED);
      expect(await count('handover_records')).toBe(0);
      const booking = await ds.getRepository(ItemBooking).findOneByOrFail({
        requestId: request.id,
      });
      expect(booking.status).toBe(BookingStatus.EXPIRED);

      // Booking yang sudah dilepas tidak lagi memblokir ketersediaan.
      const availability = await as(
        tokens.siswa,
        http().get(
          `/item-types/${laptop.id}/availability?startAt=${encodeURIComponent(startAt.toISOString())}&endAt=${encodeURIComponent(endAt.toISOString())}`,
        ),
      ).expect(200);
      expect(availability.body).toMatchObject({ reserved: 0, available: 2 });
    });

    it('hanya SAPRAS yang boleh handover (SISWA/ADMIN 403, tanpa token 401)', async () => {      const { request } = await seedRequest(BorrowRequestStatus.APPROVED, [
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);
      await http().post('/handovers').send({ requestId: request.id }).expect(401);
      await as(tokens.siswa, http().post('/handovers'))
        .send({ requestId: request.id })
        .expect(403);
      await as(tokens.admin, http().post('/handovers'))
        .send({ requestId: request.id })
        .expect(403);
      expect(await count('handover_records')).toBe(0);
    });

    it.each([
      BorrowRequestStatus.WAITING_APPROVAL,
      BorrowRequestStatus.EXPIRED,
      BorrowRequestStatus.REJECTED,
    ])('status %s tidak dapat handover', async (status) => {
      const { request } = await seedRequest(status, [
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);
      const res = await handover(request.id, [{ requestItemId: (await ds.getRepository(BorrowRequestItem).findOneByOrFail({ requestId: request.id })).id, inventoryUnitIds: [lpt1.id] }]).expect(409);
      expect(res.body.code).toBe('INVALID_STATUS');
      expect(await count('handover_records')).toBe(0);
    });

    it('handover kedua ditolak dan yang pertama tetap utuh', async () => {
      const { request } = await seedRequest(BorrowRequestStatus.APPROVED, [
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);
      await handover(request.id, [{ requestItemId: (await ds.getRepository(BorrowRequestItem).findOneByOrFail({ requestId: request.id })).id, inventoryUnitIds: [lpt1.id] }]).expect(201);
      const res = await handover(request.id, [{ requestItemId: (await ds.getRepository(BorrowRequestItem).findOneByOrFail({ requestId: request.id })).id, inventoryUnitIds: [lpt1.id] }]).expect(409);
      expect(res.body.code).toBe('HANDOVER_EXISTS');
      expect(await count('handover_records')).toBe(1);
    });

    it('jumlah unit booking harus sesuai quantity request', async () => {
      const { request } = await seedRequest(BorrowRequestStatus.APPROVED, [
        { type: laptop, quantity: 2, units: [lpt1] },
      ]);
      const item = await ds.getRepository(BorrowRequestItem).findOneByOrFail({ requestId: request.id });
      const res = await handover(request.id, [{ requestItemId: item.id, inventoryUnitIds: [lpt1.id] }]).expect(409);
      expect(res.body.code).toBe('UNIT_QUANTITY_MISMATCH');
      expect(await count('handover_records')).toBe(0);
    });

    it('unit booking harus bertipe sama dengan item type request', async () => {
      const { request } = await seedRequest(BorrowRequestStatus.APPROVED, [
        { type: laptop, quantity: 1, units: [prj1] },
      ]);
      const item = await ds.getRepository(BorrowRequestItem).findOneByOrFail({ requestId: request.id });
      const res = await handover(request.id, [{ requestItemId: item.id, inventoryUnitIds: [prj1.id] }]).expect(409);
      expect(res.body.code).toBe('INVENTORY_UNIT_TYPE_MISMATCH');
      expect(await count('handover_records')).toBe(0);
    });

    it('consumable: stok berkurang saat handover dan STOCK_OUT tercatat', async () => {
      const { request } = await seedRequest(BorrowRequestStatus.APPROVED, [
        { type: spidol, quantity: 5 },
      ]);

      const res = await handover(request.id).expect(201);
      expect(await stockOf(spidol)).toBe(45);
      const movements = await ds.getRepository(StockMovement).find();
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: StockMovementType.STOCK_OUT,
        quantity: 5,
        referenceId: res.body.id,
      });
      expect(res.body.items[0]).toMatchObject({
        inventoryUnitId: null,
        quantityHandedOver: 5,
      });
    });

    it('stok tidak cukup -> 409 dan tidak ada perubahan', async () => {
      await ds.query(
        `UPDATE consumable_stocks SET current_stock = 3 WHERE item_type_id = $1`,
        [spidol.id],
      );
      const { request } = await seedRequest(BorrowRequestStatus.APPROVED, [
        { type: spidol, quantity: 5 },
      ]);

      const res = await handover(request.id).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect(await stockOf(spidol)).toBe(3);
      expect(await count('stock_movements')).toBe(0);
      expect(await count('handover_records')).toBe(0);
      expect(await requestStatus(request.id)).toBe(BorrowRequestStatus.APPROVED);
    });

    it('multi-item atomic: satu item gagal -> seluruh handover rollback', async () => {
      await ds.query(
        `UPDATE consumable_stocks SET current_stock = 2 WHERE item_type_id = $1`,
        [spidol.id],
      );
      const { request } = await seedRequest(BorrowRequestStatus.APPROVED, [
        { type: laptop, quantity: 1, units: [lpt1] },
        { type: spidol, quantity: 5 },
      ]);

      await handover(request.id).expect(409);
      expect(await count('handover_records')).toBe(0);
      expect(await count('handover_items')).toBe(0);
      expect(await count('stock_movements')).toBe(0);
      expect(
        (await ds.getRepository(InventoryUnit).findOneByOrFail({ id: lpt1.id }))
          .availabilityStatus,
      ).toBe(AvailabilityStatus.AVAILABLE);
      expect(await stockOf(spidol)).toBe(2);
      expect(await requestStatus(request.id)).toBe(BorrowRequestStatus.APPROVED);
    });
  });

  // ================================================================ RETURN
  describe('return', () => {
    async function handedOver(lines: Line[]) {
      const seeded = await seedRequest(BorrowRequestStatus.APPROVED, lines);

      const requestItems = await ds.getRepository(BorrowRequestItem).find({
        where: { requestId: seeded.request.id },
      });

      // Unit fisik dipilih SAPRAS saat handover (Sprint 9). Pilihan harus
      // mengikuti unit yang diberikan tiap baris test, bukan hardcode.
      const selections = lines
        .filter((line) => line.type.itemClass === ItemClass.PER_UNIT)
        .map((line) => {
          const requestItem = requestItems.find(
            (item) => item.itemTypeId === line.type.id,
          );
          if (!requestItem) {
            throw new Error(
              `Request item untuk tipe ${line.type.name} tidak ditemukan`,
            );
          }
          return {
            requestItemId: requestItem.id,
            inventoryUnitIds: (line.units ?? []).map((unit) => unit.id),
          };
        });

      const res = await handover(
        seeded.request.id,
        selections.length > 0 ? selections : undefined,
      ).expect(201);

      return {
        request: seeded.request,
        handoverItems: res.body.items as Array<{ id: string }>,
      };
    }

    it('barang per unit dapat dikembalikan dan request menjadi RETURNED', async () => {
      const { request, handoverItems } = await handedOver([
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);

      const res = await receive(request.id, [
        {
          handoverItemId: handoverItems[0].id,
          returnCondition: ItemCondition.LAYAK_PAKAI,
        },
      ]).expect(201);

      expect(res.body.requestId).toBe(request.id);
      expect(res.body.items).toHaveLength(1);
      expect(await requestStatus(request.id)).toBe(
        BorrowRequestStatus.RETURNED,
      );
      const unit = await ds
        .getRepository(InventoryUnit)
        .findOneByOrFail({ id: lpt1.id });
      expect(unit.availabilityStatus).toBe(AvailabilityStatus.AVAILABLE);
      expect(
        (await ds.getRepository(ItemBooking).findOneByOrFail({
          requestId: request.id,
        })).status,
      ).toBe(BookingStatus.COMPLETED);
    });

    it('PERLU_DIPERBAIKI -> unit REPAIR + repair record', async () => {
      const { request, handoverItems } = await handedOver([
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);

      await receive(request.id, [
        {
          handoverItemId: handoverItems[0].id,
          returnCondition: ItemCondition.PERLU_DIPERBAIKI,
          notes: 'Layar retak',
        },
      ]).expect(201);

      const unit = await ds
        .getRepository(InventoryUnit)
        .findOneByOrFail({ id: lpt1.id });
      expect(unit.availabilityStatus).toBe(AvailabilityStatus.REPAIR);
      expect(unit.currentCondition).toBe(ItemCondition.PERLU_DIPERBAIKI);
      const repairs = await ds.getRepository(RepairRecord).find();
      expect(repairs).toHaveLength(1);
      expect(repairs[0]).toMatchObject({
        inventoryUnitId: lpt1.id,
        problemDescription: 'Layar retak',
      });
    });

    it('PERLU_DIPERBAIKI -> repair ditemukan lewat API lalu start & complete', async () => {
      const { request, handoverItems } = await handedOver([
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);

      await receive(request.id, [
        {
          handoverItemId: handoverItems[0].id,
          returnCondition: ItemCondition.PERLU_DIPERBAIKI,
          notes: 'Layar retak',
        },
      ]).expect(201);

      // Discovery hanya lewat public API, bukan query langsung ke database.
      const list = await as(
        tokens.sapras,
        http().get(
          `/repairs?inventoryUnitId=${lpt1.id}&repairStatus=MENUNGGU_PERBAIKAN`,
        ),
      ).expect(200);
      expect(list.body.meta).toMatchObject({ total: 1, page: 1, limit: 20 });
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({
        inventoryUnitId: lpt1.id,
        repairStatus: 'MENUNGGU_PERBAIKAN',
        problemDescription: 'Layar retak',
        inventoryUnit: { id: lpt1.id },
      });
      const repairId = list.body.data[0].id as string;

      await as(
        tokens.sapras,
        http().post(`/repairs/${repairId}/start`),
      ).send({}).expect(200);
      const done = await as(
        tokens.sapras,
        http().post(`/repairs/${repairId}/complete`),
      )
        .send({ repairNotes: 'Layar diganti' })
        .expect(200);
      expect(done.body).toMatchObject({
        id: repairId,
        repairStatus: 'SELESAI_DIPERBAIKI',
        inventoryUnit: {
          id: lpt1.id,
          currentCondition: ItemCondition.LAYAK_PAKAI,
          availabilityStatus: AvailabilityStatus.AVAILABLE,
        },
      });

      const finished = await as(
        tokens.sapras,
        http().get(`/repairs?repairStatus=SELESAI_DIPERBAIKI`),
      ).expect(200);
      expect(finished.body.data.map((r: { id: string }) => r.id)).toEqual([
        repairId,
      ]);
    });

    it('RUSAK_TOTAL -> unit UNAVAILABLE (tidak kembali AVAILABLE)', async () => {
      const { request, handoverItems } = await handedOver([
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);

      await receive(request.id, [
        {
          handoverItemId: handoverItems[0].id,
          returnCondition: ItemCondition.RUSAK_TOTAL,
        },
      ]).expect(201);

      const unit = await ds
        .getRepository(InventoryUnit)
        .findOneByOrFail({ id: lpt1.id });
      expect(unit.availabilityStatus).toBe(AvailabilityStatus.UNAVAILABLE);
      expect(unit.currentCondition).toBe(ItemCondition.RUSAK_TOTAL);
    });

    it('item dari handover request lain ditolak', async () => {
      const first = await handedOver([
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);
      const second = await handedOver([
        { type: laptop, quantity: 1, units: [lpt2] },
      ]);

      const res = await receive(first.request.id, [
        {
          handoverItemId: second.handoverItems[0].id,
          returnCondition: ItemCondition.LAYAK_PAKAI,
        },
      ]).expect(400);
      expect(res.body.code).toBe('HANDOVER_ITEM_MISMATCH');
      expect(await count('return_records')).toBe(0);
    });

    it('return kedua untuk request yang sama ditolak', async () => {
      const { request, handoverItems } = await handedOver([
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);
      const payload = [
        {
          handoverItemId: handoverItems[0].id,
          returnCondition: ItemCondition.LAYAK_PAKAI,
        },
      ];
      await receive(request.id, payload).expect(201);
      const res = await receive(request.id, payload).expect(409);
      expect(res.body.code).toBe('RETURN_EXISTS');
    });

    it('hanya SAPRAS yang boleh return (SISWA/ADMIN 403)', async () => {
      const { request, handoverItems } = await handedOver([
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);
      const payload = {
        requestId: request.id,
        items: [
          {
            handoverItemId: handoverItems[0].id,
            returnCondition: ItemCondition.LAYAK_PAKAI,
          },
        ],
      };
      await as(tokens.siswa, http().post('/returns')).send(payload).expect(403);
      await as(tokens.admin, http().post('/returns')).send(payload).expect(403);
      expect(await count('return_records')).toBe(0);
    });

    it('return sebelum handover ditolak', async () => {
      const { request } = await seedRequest(BorrowRequestStatus.APPROVED, [
        { type: laptop, quantity: 1, units: [lpt1] },
      ]);
      const res = await receive(request.id, [
        {
          handoverItemId: '3b241101-e2bb-4255-8caf-4136c566a962',
          returnCondition: ItemCondition.LAYAK_PAKAI,
        },
      ]).expect(409);
      expect(res.body.code).toBe('INVALID_STATUS');
    });

    it('consumable tidak dikembalikan seperti barang per unit', async () => {
      const { request } = await handedOver([{ type: spidol, quantity: 2 }]);
      const res = await receive(request.id, [
        {
          handoverItemId: '3b241101-e2bb-4255-8caf-4136c566a962',
          returnCondition: ItemCondition.LAYAK_PAKAI,
        },
      ]).expect(400);
      expect(res.body.code).toBe('NOTHING_TO_RETURN');
    });
  });
});
