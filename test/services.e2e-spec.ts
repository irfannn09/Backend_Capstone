import { INestApplication } from '@nestjs/common';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ItemClass, StockMovementType, UserRole } from '../src/common/enums';
import { ConsumableStocksService } from '../src/inventory/consumable-stocks.service';
import { ConsumableStock } from '../src/inventory/entities/consumable-stock.entity';
import { InventoryUnitsService } from '../src/inventory/inventory-units.service';
import { ItemCategoriesService } from '../src/master-data/item-categories.service';
import { ItemTypesService } from '../src/master-data/item-types.service';
import { LocationsService } from '../src/master-data/locations.service';
import { StockMovement } from '../src/stock/entities/stock-movement.entity';
import { UsersService } from '../src/users/users.service';
import { createTestApp, resetDatabase } from './utils/test-app';

/** Checkpoint Sprint 5: lapisan service + repository bekerja pada database nyata. */
describe('Sprint 5 - service layer (tanpa HTTP)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
  });
  afterAll(async () => app.close());

  it('UsersService membuat siswa + profile, menolak duplikat & mismatch', async () => {
    const users = app.get(UsersService);
    const created = await users.create({
      role: UserRole.SISWA, name: 'Budi', password: 'Rahasia123', nis: '1001', className: 'X-A',
    });
    expect(created.mustChangePassword).toBe(true);
    expect(created.profile?.nis).toBe('1001');
    expect(JSON.stringify(created)).not.toMatch(/passwordHash|password_hash|Rahasia123/);

    await expect(
      users.create({ role: UserRole.SISWA, name: 'Dup', password: 'Rahasia123', nis: '1001', className: 'X-B' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      users.create({ role: UserRole.SISWA, name: 'Salah', password: 'Rahasia123', nik: '999', className: 'X-A' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Master data + inventory: aturan PER_UNIT vs CONSUMABLE', async () => {
    const cats = app.get(ItemCategoriesService);
    const locs = app.get(LocationsService);
    const types = app.get(ItemTypesService);
    const units = app.get(InventoryUnitsService);
    const stocks = app.get(ConsumableStocksService);

    const cat = await cats.create({ name: 'Elektronik' });
    await expect(cats.create({ name: 'elektronik' })).rejects.toBeInstanceOf(ConflictException);
    const loc = await locs.create({ name: 'Gudang A' });
    const laptop = await types.create({ categoryId: cat.id, name: 'Laptop', itemClass: ItemClass.PER_UNIT, unitName: 'unit' });
    const spidol = await types.create({ categoryId: cat.id, name: 'Spidol', itemClass: ItemClass.CONSUMABLE, unitName: 'pcs' });
    const actor = await app.get(UsersService).create({
      role: UserRole.SISWA, name: 'Aktor Stok', password: 'Rahasia123', nis: '1002', className: 'X-B',
    });

    const unit = await units.create({ itemTypeId: laptop.id, locationId: loc.id, inventoryCode: 'LPT-001', barcode: 'BC-1' });
    expect(unit.currentCondition).toBe('LAYAK_PAKAI');
    expect(unit.availabilityStatus).toBe('AVAILABLE');
    await expect(
      units.create({ itemTypeId: spidol.id, locationId: loc.id, inventoryCode: 'SPD-1', barcode: 'BC-2' }),
    ).rejects.toBeInstanceOf(ConflictException);

    await stocks.create(actor.id, { itemTypeId: spidol.id, currentStock: 10, minimumStock: 2 });
    await expect(stocks.create(actor.id, { itemTypeId: spidol.id, currentStock: 1, minimumStock: 1 })).rejects.toBeInstanceOf(ConflictException);
    await expect(stocks.create(actor.id, { itemTypeId: laptop.id, currentStock: 1, minimumStock: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('Sprint 11: initial stock -> STOCK_IN; update tidak menambah; movement gagal rollback', async () => {
    const users = app.get(UsersService);
    const cats = app.get(ItemCategoriesService);
    const types = app.get(ItemTypesService);
    const stocks = app.get(ConsumableStocksService);
    const ds = app.get(DataSource);

    const actor = await users.create({
      role: UserRole.SISWA, name: 'Aktor Stok 11', password: 'Rahasia123', nis: '1003', className: 'XI-A',
    });
    const cat = await cats.create({ name: 'ATK Sprint 11' });
    const kertas = await types.create({ categoryId: cat.id, name: 'Kertas', itemClass: ItemClass.CONSUMABLE, unitName: 'rim' });
    const pensil = await types.create({ categoryId: cat.id, name: 'Pensil', itemClass: ItemClass.CONSUMABLE, unitName: 'pcs' });

    const stock = await stocks.create(actor.id, { itemTypeId: kertas.id, currentStock: 7, minimumStock: 2 });
    const movements = await ds.getRepository(StockMovement).find({ where: { consumableStockId: stock.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: StockMovementType.STOCK_IN,
      quantity: 7,
      referenceId: null,
      createdBy: actor.id,
    });

    await stocks.update(stock.id, { minimumStock: 5 });
    expect(await ds.getRepository(StockMovement).count({ where: { consumableStockId: stock.id } })).toBe(1);

    // createdBy tidak valid -> FK gagal di tengah transaksi; ConsumableStock harus rollback.
    const missingUser = '3b241101-e2bb-4255-8caf-4136c566a962';
    await expect(
      stocks.create(missingUser, { itemTypeId: pensil.id, currentStock: 4, minimumStock: 0 }),
    ).rejects.toBeTruthy();
    expect(await ds.getRepository(ConsumableStock).count({ where: { itemTypeId: pensil.id } })).toBe(0);
  });
});
