import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { StockMovementType, AvailabilityStatus, ItemCondition, UserRole } from '../src/common/enums';
import { ConsumableStock } from '../src/inventory/entities/consumable-stock.entity';
import { InventoryUnit } from '../src/inventory/entities/inventory-unit.entity';
import { StockMovement } from '../src/stock/entities/stock-movement.entity';
import { createTestApp, loginAs, resetDatabase, seedUser } from './utils/test-app';

describe('Inventory (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let sapras: string;
  let siswa: string;
  let saprasId: string;
  let categoryId: string;
  let laptopId: string;
  let spidolId: string;
  let locationId: string;
  const http = () => request(app.getHttpServer());
  const as = (t: string, r: request.Test) => r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    await resetDatabase(app);
    await seedUser(app, { role: UserRole.ADMIN, email: 'admin@sekolah.id' });
    const saprasUser = await seedUser(app, { role: UserRole.SAPRAS, email: 'sapras@sekolah.id' });
    saprasId = saprasUser.id;
    await seedUser(app, { role: UserRole.SISWA, nis: '1001', className: 'X-A' });
    admin = await loginAs(app, 'admin@sekolah.id');
    sapras = await loginAs(app, 'sapras@sekolah.id');
    siswa = await loginAs(app, '1001');

    const cat = await as(admin, http().post('/item-categories')).send({ name: 'Elektronik' });
    categoryId = cat.body.id;
    locationId = (await as(admin, http().post('/locations')).send({ name: 'Gudang A' })).body.id;
    laptopId = (await as(admin, http().post('/item-types')).send({ categoryId: cat.body.id, name: 'Laptop', itemClass: 'PER_UNIT', unitName: 'unit' })).body.id;
    spidolId = (await as(admin, http().post('/item-types')).send({ categoryId: cat.body.id, name: 'Spidol', itemClass: 'CONSUMABLE', unitName: 'pcs' })).body.id;
  });
  afterAll(async () => app.close());

  const unit = (over: object = {}) => ({
    itemTypeId: laptopId, locationId, inventoryCode: 'LPT-001', barcode: 'BC-001', ...over,
  });

  describe('inventory units', () => {
    let unitId: string;

    it('SAPRAS membuat unit PER_UNIT dengan default condition & availability', async () => {
      const res = await as(sapras, http().post('/inventory-units')).send(unit({ serialNumber: 'SN-1', purchaseDate: '2025-01-15', notes: 'Baru' })).expect(201);
      expect(res.body).toMatchObject({
        inventoryCode: 'LPT-001', barcode: 'BC-001', serialNumber: 'SN-1', purchaseDate: '2025-01-15',
        currentCondition: 'LAYAK_PAKAI', availabilityStatus: 'AVAILABLE',
        itemType: { id: laptopId }, location: { id: locationId },
      });
      unitId = res.body.id;
    });

    it('serial_number boleh kosong', async () => {
      const res = await as(sapras, http().post('/inventory-units')).send(unit({ inventoryCode: 'LPT-002', barcode: 'BC-002' })).expect(201);
      expect(res.body.serialNumber).toBeNull();
    });

    it('inventory unit untuk item CONSUMABLE ditolak (409)', async () => {
      await as(sapras, http().post('/inventory-units')).send(unit({ itemTypeId: spidolId, inventoryCode: 'SPD-1', barcode: 'BC-S1' })).expect(409);
    });

    it('duplikat inventory_code / barcode -> 409', async () => {
      await as(sapras, http().post('/inventory-units')).send(unit({ barcode: 'BC-BARU' })).expect(409);
      await as(sapras, http().post('/inventory-units')).send(unit({ inventoryCode: 'LPT-BARU' })).expect(409);
    });

    it('validasi: UUID, enum, tanggal, field asing; relasi tidak ada -> 404', async () => {
      const post = (b: object) => as(sapras, http().post('/inventory-units')).send(b);
      await post(unit({ itemTypeId: 'x', inventoryCode: 'A1', barcode: 'B1' })).expect(400);
      await post(unit({ inventoryCode: 'A2', barcode: 'B2', currentCondition: 'BAGUS' })).expect(400);
      await post(unit({ inventoryCode: 'A3', barcode: 'B3', purchaseDate: '15/01/2025' })).expect(400);
      await post(unit({ inventoryCode: 'A4', barcode: 'B4', id: 'x' })).expect(400);
      await post(unit({ inventoryCode: '', barcode: 'B5' })).expect(400);
      await post(unit({ inventoryCode: 'A6', barcode: 'B6', locationId: '3b241101-e2bb-4255-8caf-4136c566a962' })).expect(404);
    });

    it('availability BOOKED/BORROWED tidak boleh diset manual', async () => {
      await as(sapras, http().post('/inventory-units')).send(unit({ inventoryCode: 'A7', barcode: 'B7', availabilityStatus: 'BORROWED' })).expect(400);
      await as(sapras, http().patch(`/inventory-units/${unitId}`)).send({ availabilityStatus: 'BOOKED' }).expect(400);
    });

    it('condition dan availability independen (PERLU_DIPERBAIKI + REPAIR)', async () => {
      const res = await as(sapras, http().patch(`/inventory-units/${unitId}`)).send({ currentCondition: 'PERLU_DIPERBAIKI', availabilityStatus: 'REPAIR' }).expect(200);
      expect(res.body).toMatchObject({ currentCondition: 'PERLU_DIPERBAIKI', availabilityStatus: 'REPAIR' });
      const only = await as(sapras, http().patch(`/inventory-units/${unitId}`)).send({ currentCondition: 'LAYAK_PAKAI' }).expect(200);
      expect(only.body.availabilityStatus).toBe('REPAIR'); // tidak ikut berubah
      await as(sapras, http().patch(`/inventory-units/${unitId}`)).send({ availabilityStatus: 'AVAILABLE' }).expect(200);
    });

    it('update: itemType tidak bisa dipindah; duplikat barcode 409; kode milik sendiri OK', async () => {
      await as(sapras, http().patch(`/inventory-units/${unitId}`)).send({ itemTypeId: spidolId }).expect(400);
      await as(sapras, http().patch(`/inventory-units/${unitId}`)).send({ barcode: 'BC-002' }).expect(409);
      await as(sapras, http().patch(`/inventory-units/${unitId}`)).send({ barcode: 'BC-001', notes: null }).expect(200);
    });

    it('unit yang sedang BOOKED/BORROWED dikunci dari perubahan manual (409)', async () => {
      const ds = (await import('typeorm')).DataSource;
      await app.get(ds).query(`UPDATE inventory_units SET availability_status = 'BORROWED' WHERE id = $1`, [unitId]);
      await as(sapras, http().patch(`/inventory-units/${unitId}`)).send({ availabilityStatus: 'AVAILABLE' }).expect(409);
      await as(sapras, http().patch(`/inventory-units/${unitId}`)).send({ notes: 'catatan boleh' }).expect(200);
      await app.get(ds).query(`UPDATE inventory_units SET availability_status = 'AVAILABLE' WHERE id = $1`, [unitId]);
    });

    it('PATCH field lain tidak mengembalikan availability/condition ke snapshot lama', async () => {
      const runner = ds.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      // Meniru transaksi handover/return/repair yang mengubah row yang sama.
      await runner.manager.update(
        InventoryUnit,
        { id: unitId },
        {
          availabilityStatus: AvailabilityStatus.BORROWED,
          currentCondition: ItemCondition.PERLU_DIPERBAIKI,
        },
      );

      const patch = as(sapras, http().patch(`/inventory-units/${unitId}`))
        .send({ notes: 'catatan setelah transaksi lain' })
        .expect(200)
        .then((res) => res);

      await new Promise((resolve) => setTimeout(resolve, 150));
      await runner.commitTransaction();
      await runner.release();
      await patch;

      const after = await ds
        .getRepository(InventoryUnit)
        .findOneByOrFail({ id: unitId });
      expect(after.availabilityStatus).toBe(AvailabilityStatus.BORROWED);
      expect(after.currentCondition).toBe(ItemCondition.PERLU_DIPERBAIKI);
      expect(after.notes).toBe('catatan setelah transaksi lain');

      await ds.query(
        `UPDATE inventory_units SET availability_status = 'AVAILABLE', current_condition = 'LAYAK_PAKAI' WHERE id = $1`,
        [unitId],
      );
    });

    it('read: ADMIN boleh (monitoring), filter & search bekerja', async () => {
      const list = await as(admin, http().get('/inventory-units?search=LPT-00')).expect(200);
      expect(list.body.meta.total).toBe(2);
      const f = await as(admin, http().get(`/inventory-units?itemTypeId=${laptopId}&availabilityStatus=AVAILABLE`)).expect(200);
      expect(f.body.data.length).toBeGreaterThan(0);
      await as(admin, http().get(`/inventory-units/${unitId}`)).expect(200);
      await as(admin, http().get('/inventory-units?availabilityStatus=SALAH')).expect(400);
    });

    it('ADMIN tidak boleh menjalankan fungsi SAPRAS (403) dan SISWA tidak boleh mengakses (403)', async () => {
      await as(admin, http().post('/inventory-units')).send(unit({ inventoryCode: 'ADM-1', barcode: 'ADM-1' })).expect(403);
      await as(admin, http().patch(`/inventory-units/${unitId}`)).send({ notes: 'x' }).expect(403);
      await as(siswa, http().get('/inventory-units')).expect(403);
      await http().get('/inventory-units').expect(401);
    });
  });

  describe('consumable stocks', () => {
    let stockId: string;

    it('SAPRAS membuat stok untuk CONSUMABLE', async () => {
      const res = await as(sapras, http().post('/consumable-stocks')).send({ itemTypeId: spidolId, currentStock: 50, minimumStock: 10 }).expect(201);
      expect(res.body).toMatchObject({ currentStock: 50, minimumStock: 10, itemType: { id: spidolId, name: 'Spidol' } });
      stockId = res.body.id;
    });

    it('stok awal dicatat sebagai STOCK_IN; quantity = currentStock; createdBy dari JWT', async () => {
      const movements = await ds.getRepository(StockMovement).find({ where: { consumableStockId: stockId } });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: StockMovementType.STOCK_IN,
        quantity: 50,
        referenceId: null,
        createdBy: saprasId,
      });
    });

    it('stok untuk item PER_UNIT ditolak (409)', async () => {
      await as(sapras, http().post('/consumable-stocks')).send({ itemTypeId: laptopId, currentStock: 1, minimumStock: 0 }).expect(409);
    });

    it('stok ganda untuk satu item type ditolak (409)', async () => {
      await as(sapras, http().post('/consumable-stocks')).send({ itemTypeId: spidolId, currentStock: 5, minimumStock: 1 }).expect(409);
    });

    it('stok negatif / pecahan / bukan angka ditolak (400)', async () => {
      const post = (b: object) => as(sapras, http().post('/consumable-stocks')).send(b);
      await post({ itemTypeId: spidolId, currentStock: -1, minimumStock: 0 }).expect(400);
      await post({ itemTypeId: spidolId, currentStock: 1, minimumStock: -5 }).expect(400);
      await post({ itemTypeId: spidolId, currentStock: 1.5, minimumStock: 0 }).expect(400);
      await post({ itemTypeId: spidolId, currentStock: '10', minimumStock: 0 }).expect(400);
      await post({ itemTypeId: 'x', currentStock: 1, minimumStock: 0 }).expect(400);
    });

    it('item type tidak ada -> 404', async () => {
      await as(sapras, http().post('/consumable-stocks')).send({ itemTypeId: '3b241101-e2bb-4255-8caf-4136c566a962', currentStock: 1, minimumStock: 0 }).expect(404);
    });

    it('update hanya minimum_stock; current_stock tidak bisa diubah langsung', async () => {
      await as(sapras, http().patch(`/consumable-stocks/${stockId}`)).send({ minimumStock: 20 }).expect(200);
      await as(sapras, http().patch(`/consumable-stocks/${stockId}`)).send({ minimumStock: -1 }).expect(400);
      await as(sapras, http().patch(`/consumable-stocks/${stockId}`)).send({ minimumStock: 5, currentStock: 999 }).expect(400);
      const one = await as(sapras, http().get(`/consumable-stocks/${stockId}`)).expect(200);
      expect(one.body.currentStock).toBe(50);
      // Update tidak boleh membuat STOCK_IN baru.
      expect(await ds.getRepository(StockMovement).count({ where: { consumableStockId: stockId } })).toBe(1);
    });

    it('PATCH minimumStock tidak menimpa currentStock saat STOCK_OUT bersamaan', async () => {
      const before = (
        await ds.getRepository(ConsumableStock).findOneByOrFail({ id: stockId })
      ).currentStock;

      const runner = ds.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.manager.update(
        ConsumableStock,
        { id: stockId },
        { currentStock: before - 1 },
      );

      const patch = as(sapras, http().patch(`/consumable-stocks/${stockId}`))
        .send({ minimumStock: 13 })
        .expect(200)
        .then((res) => res);

      await new Promise((resolve) => setTimeout(resolve, 150));
      await runner.commitTransaction();
      await runner.release();
      await patch;

      const after = await ds
        .getRepository(ConsumableStock)
        .findOneByOrFail({ id: stockId });
      expect(after.currentStock).toBe(before - 1);
      expect(after.minimumStock).toBe(13);
    });

    it('filter lowStock; ADMIN read-only; SISWA ditolak', async () => {
      await as(sapras, http().patch(`/consumable-stocks/${stockId}`)).send({ minimumStock: 60 }).expect(200);
      const low = await as(admin, http().get('/consumable-stocks?lowStock=true')).expect(200);
      expect(low.body.data).toHaveLength(1);
      await as(admin, http().post('/consumable-stocks')).send({ itemTypeId: spidolId, currentStock: 1, minimumStock: 0 }).expect(403);
      await as(siswa, http().get('/consumable-stocks')).expect(403);
    });

    it('createdBy dari body ditolak; movement tetap memakai user JWT', async () => {
      const type = await as(admin, http().post('/item-types')).send({
        categoryId, name: 'Pulpen', itemClass: 'CONSUMABLE', unitName: 'pcs',
      }).expect(201);

      await as(sapras, http().post('/consumable-stocks')).send({
        itemTypeId: type.body.id, currentStock: 3, minimumStock: 0, createdBy: 'user-lain',
      }).expect(400);
      expect(await ds.getRepository(ConsumableStock).count({ where: { itemTypeId: type.body.id } })).toBe(0);

      const created = await as(sapras, http().post('/consumable-stocks')).send({
        itemTypeId: type.body.id, currentStock: 3, minimumStock: 0,
      }).expect(201);
      const movement = await ds.getRepository(StockMovement).findOneByOrFail({
        consumableStockId: created.body.id,
      });
      expect(movement.createdBy).toBe(saprasId);
    });

    it('currentStock = 0 tetap dicatat sebagai STOCK_IN quantity 0', async () => {
      const type = await as(admin, http().post('/item-types')).send({
        categoryId, name: 'Map', itemClass: 'CONSUMABLE', unitName: 'pcs',
      }).expect(201);

      const created = await as(sapras, http().post('/consumable-stocks')).send({
        itemTypeId: type.body.id, currentStock: 0, minimumStock: 0,
      }).expect(201);
      const movements = await ds.getRepository(StockMovement).find({
        where: { consumableStockId: created.body.id },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ type: StockMovementType.STOCK_IN, quantity: 0 });
    });
  });
});
