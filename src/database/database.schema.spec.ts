import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './typeorm.config';

const EXPECTED_TABLES = [
  'roles', 'users', 'profiles',
  'face_profiles', 'face_verifications',
  'item_categories', 'item_types', 'locations',
  'inventory_units', 'consumable_stocks', 'repair_records',
  'borrow_requests', 'borrow_request_items', 'item_bookings',
  'handover_records', 'handover_items',
  'return_records', 'return_items', 'stock_movements',
  'notifications',
];

/**
 * Test struktur schema TANPA koneksi database:
 * hanya membangun metadata TypeORM dari entity.
 */
describe('Database schema (entity metadata)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions({}));
    await (dataSource as any).buildMetadatas();
  });

  const table = (name: string) =>
    dataSource.entityMetadatas.find((m) => m.tableName === name)!;
  const columns = (name: string) =>
    table(name).columns.map((c) => c.databaseName);

  it('synchronize harus false', () => {
    expect(dataSource.options.synchronize).toBe(false);
  });

  it('memiliki tepat 20 tabel sesuai ERD final', () => {
    const names = dataSource.entityMetadatas.map((m) => m.tableName).sort();
    expect(names).toEqual([...EXPECTED_TABLES].sort());
  });

  it('semua primary key bertipe UUID', () => {
    for (const meta of dataSource.entityMetadatas) {
      expect(meta.primaryColumns).toHaveLength(1);
      expect(meta.primaryColumns[0].type).toBe('uuid');
    }
  });

  it('tidak ada FK yang memakai ON DELETE CASCADE', () => {
    for (const meta of dataSource.entityMetadatas) {
      for (const fk of meta.foreignKeys) {
        expect(fk.onDelete).not.toBe('CASCADE');
      }
    }
  });

  it('borrow_request_items TIDAK punya inventory_unit_id', () => {
    expect(columns('borrow_request_items')).not.toContain('inventory_unit_id');
  });

  it('handover_items.inventory_unit_id nullable (consumable)', () => {
    const col = table('handover_items').columns.find(
      (c) => c.databaseName === 'inventory_unit_id',
    )!;
    expect(col.isNullable).toBe(true);
  });

  it('stock_movements.reference_id tidak memakai FK', () => {
    const fkCols = table('stock_movements').foreignKeys.flatMap((fk) =>
      fk.columnNames,
    );
    expect(fkCols).not.toContain('reference_id');
  });

  it('inventory_units memisahkan condition dan availability', () => {
    const cols = columns('inventory_units');
    expect(cols).toContain('current_condition');
    expect(cols).toContain('availability_status');
  });

  it('tabel yang dilarang tidak ada', () => {
    const names = dataSource.entityMetadatas.map((m) => m.tableName);
    for (const banned of [
      'student_profiles', 'teacher_profiles', 'condition_histories', 'audit_logs',
      'forecast_results',
    ]) {
      expect(names).not.toContain(banned);
    }
  });

  it('total foreign key = 28', () => {
    const total = dataSource.entityMetadatas.reduce(
      (n, m) => n + m.foreignKeys.length, 0);
    expect(total).toBe(28);
  });
  it('return_items: FK ke return_records & handover_items, TANPA inventory_unit_id', () => {
    expect(columns('return_items')).not.toContain('inventory_unit_id');
    const fks = table('return_items').foreignKeys.map(
      (fk) => `${fk.columnNames[0]}->${fk.referencedTablePath}`,
    );
    expect(fks.sort()).toEqual(['handover_item_id->handover_items', 'return_id->return_records']);
  });

  it('return_items.return_condition memakai enum kondisi yang sama', () => {
    const col = table('return_items').columns.find((c) => c.databaseName === 'return_condition')!;
    expect(col.enum).toEqual(['LAYAK_PAKAI', 'PERLU_DIPERBAIKI', 'RUSAK_TOTAL']);
  });

  it('item_types tidak punya relasi forecasting', () => {
    const rels = table('item_types').relations.map((r) => r.propertyName);
    expect(rels.some((n) => /forecast/i.test(n))).toBe(false);
  });
});
