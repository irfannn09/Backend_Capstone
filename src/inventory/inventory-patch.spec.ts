import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AvailabilityStatus, ItemCondition } from '../common/enums';
import { Location } from '../master-data/entities/location.entity';
import { ItemType } from '../master-data/entities/item-type.entity';
import { ConsumableStocksService } from './consumable-stocks.service';
import { ConsumableStock } from './entities/consumable-stock.entity';
import { InventoryUnit } from './entities/inventory-unit.entity';
import { InventoryUnitsService } from './inventory-units.service';

type Row = Record<string, any>;

/**
 * Regression test deterministik untuk B4: PATCH tidak boleh menulis ulang
 * snapshot lama. Manager palsu ini SENGAJA hanya punya `findOne` + `update`
 * (tanpa `save`), sehingga implementasi read-full-then-save akan gagal.
 */
function fakeDataSource(rows: Row[]) {
  const manager = {
    findOne: jest.fn(async (entity: unknown, options: { where: Row }) => {
      const found = rows.find((row) => row.id === options.where.id);
      return found ? { ...found } : null;
    }),
    update: jest.fn(async (entity: unknown, criteria: Row, patch: Row) => {
      const row = rows.find((item) => item.id === criteria.id);
      if (row) Object.assign(row, patch);
      return { affected: row ? 1 : 0 };
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: (m: EntityManager) => Promise<unknown>) =>
      callback(manager as unknown as EntityManager),
    ),
  };
  return { dataSource: dataSource as unknown as DataSource, manager };
}

function fakeRepo(rows: Row[]): Repository<any> {
  return {
    findOne: jest.fn(async (options: { where: Row }) => {
      const found = rows.find((row) => row.id === options.where.id);
      return found ?? null;
    }),
  } as unknown as Repository<any>;
}

describe('PATCH inventory concurrency safety (B4)', () => {
  describe('ConsumableStocksService.update', () => {
    it('mengunci baris dan hanya menulis minimum_stock; current_stock stale tidak kembali', async () => {
      const rows: Row[] = [
        { id: 'stock-1', itemTypeId: 'type-1', currentStock: 9, minimumStock: 2 },
      ];
      const { dataSource, manager } = fakeDataSource(rows);
      const service = new ConsumableStocksService(
        fakeRepo(rows),
        {} as Repository<ItemType>,
        dataSource,
      );

      await service.update('stock-1', { minimumStock: 7 });

      expect(manager.findOne).toHaveBeenCalledWith(ConsumableStock, {
        where: { id: 'stock-1' },
        lock: { mode: 'pessimistic_write' },
      });
      // Hanya field yang diizinkan DTO yang dikirim ke UPDATE.
      expect(manager.update).toHaveBeenCalledWith(
        ConsumableStock,
        { id: 'stock-1' },
        { minimumStock: 7 },
      );
      expect(rows[0]).toMatchObject({ currentStock: 9, minimumStock: 7 });
    });

    it('stok tidak ditemukan -> 404 tanpa update', async () => {
      const { dataSource, manager } = fakeDataSource([]);
      const service = new ConsumableStocksService(
        fakeRepo([]),
        {} as Repository<ItemType>,
        dataSource,
      );

      await expect(
        service.update('stock-x', { minimumStock: 1 }),
      ).rejects.toBeInstanceOf(Error);
      expect(manager.update).not.toHaveBeenCalled();
    });
  });

  describe('InventoryUnitsService.update', () => {
    const baseUnit = (): Row => ({
      id: 'unit-1',
      locationId: 'loc-1',
      inventoryCode: 'LPT-001',
      serialNumber: null,
      barcode: 'BC-1',
      currentCondition: ItemCondition.PERLU_DIPERBAIKI,
      availabilityStatus: AvailabilityStatus.BORROWED,
      purchaseDate: null,
      notes: null,
    });

    function build(rows: Row[]) {
      const { dataSource, manager } = fakeDataSource(rows);
      const service = new InventoryUnitsService(
        fakeRepo(rows),
        {} as Repository<ItemType>,
        {} as Repository<Location>,
        dataSource,
      );
      return { service, manager };
    }

    it('hanya menulis field yang dikirim; availability/condition hasil transaksi lain tidak kembali', async () => {
      const rows = [baseUnit()];
      const { service, manager } = build(rows);

      await service.update('unit-1', { notes: 'catatan baru' });

      expect(manager.findOne).toHaveBeenCalledWith(InventoryUnit, {
        where: { id: 'unit-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.update).toHaveBeenCalledWith(
        InventoryUnit,
        { id: 'unit-1' },
        { notes: 'catatan baru' },
      );
      expect(rows[0]).toMatchObject({
        availabilityStatus: AvailabilityStatus.BORROWED,
        currentCondition: ItemCondition.PERLU_DIPERBAIKI,
        notes: 'catatan baru',
      });
    });

    it('guard memakai state terbaru di dalam lock (BORROWED tidak bisa diubah manual)', async () => {
      const rows = [baseUnit()];
      const { service, manager } = build(rows);

      await expect(
        service.update('unit-1', {
          availabilityStatus: AvailabilityStatus.AVAILABLE,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(manager.update).not.toHaveBeenCalled();
      expect(rows[0].availabilityStatus).toBe(AvailabilityStatus.BORROWED);
    });

    it('unit tidak ditemukan -> 404 tanpa update', async () => {
      const { service, manager } = build([]);
      await expect(
        service.update('unit-x', { notes: 'x' }),
      ).rejects.toBeInstanceOf(Error);
      expect(manager.update).not.toHaveBeenCalled();
    });
  });
});
