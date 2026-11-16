import { EntityManager } from 'typeorm';

export type EntityConstructor<T extends object = object> = new () => T;
type Row = Record<string, any>;

interface FindOptionsLike {
  where?: Row;
  relations?: unknown;
  lock?: unknown;
}

/**
 * EntityManager in-memory untuk unit test service.
 * Hanya mendukung operasi yang dipakai service Sprint 9
 * (find/findOne/create/save/update + transaction dengan rollback).
 */
export class InMemoryDb {
  private readonly tables = new Map<Function, Row[]>();
  private sequence = 0;

  reset(): void {
    this.tables.clear();
    this.sequence = 0;
  }

  seed<T extends object>(
    entity: EntityConstructor<T>,
    rows: Array<Partial<T>>,
  ): T[] {
    return rows.map((row) => this.insert(entity, row as Row));
  }

  all<T extends object>(entity: EntityConstructor<T>): T[] {
    return this.tableFor(entity).slice() as T[];
  }

  get manager(): EntityManager {
    return this.createManager();
  }

  createManager(): EntityManager {
    const db = this;
    const manager = {
      create(entity: EntityConstructor, data: Row): object {
        return Object.assign(new entity(), data);
      },
      async save(target: object | object[]): Promise<object | object[]> {
        if (Array.isArray(target)) {
          return target.map((row) => db.persist(row as Row));
        }
        return db.persist(target as Row);
      },
      async findOne(
        entity: EntityConstructor,
        options: FindOptionsLike = {},
      ): Promise<object | null> {
        const found = db
          .tableFor(entity)
          .find((row) => db.matches(row, options.where));
        return (found as object | undefined) ?? null;
      },
      async find(
        entity: EntityConstructor,
        options: FindOptionsLike = {},
      ): Promise<object[]> {
        return db
          .tableFor(entity)
          .filter((row) => db.matches(row, options.where));
      },
      async update(
        entity: EntityConstructor,
        criteria: Row,
        patch: Row,
      ): Promise<{ affected: number }> {
        const rows = db
          .tableFor(entity)
          .filter((row) => db.matches(row, criteria));
        for (const row of rows) Object.assign(row, patch);
        return { affected: rows.length };
      },
    };
    return manager as unknown as EntityManager;
  }

  async transaction<T>(
    callback: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const snapshot = this.snapshot();
    const sequence = this.sequence;
    try {
      return await callback(this.createManager());
    } catch (error) {
      this.restore(snapshot);
      this.sequence = sequence;
      throw error;
    }
  }

  private tableFor(entity: Function): Row[] {
    if (!this.tables.has(entity)) this.tables.set(entity, []);
    return this.tables.get(entity)!;
  }

  private insert<T extends object>(
    entity: EntityConstructor<T>,
    data: Row,
  ): T {
    const instance = Object.assign(new entity(), data);
    const row = instance as unknown as Row;
    if (!row.id) {
      this.sequence += 1;
      row.id = `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
    }
    const table = this.tableFor(entity);
    const index = table.findIndex((existing) => existing.id === row.id);
    if (index >= 0) table[index] = row;
    else table.push(row);
    return instance;
  }

  private persist(row: Row): object {
    const entity = row.constructor as EntityConstructor;
    return this.insert(entity, row);
  }

  private matches(row: Row, where?: Row): boolean {
    if (!where) return true;
    return Object.entries(where).every(
      ([key, expected]) => row[key] === expected,
    );
  }

  private snapshot(): Array<[Function, Row[]]> {
    return [...this.tables.entries()].map(([entity, rows]) => [
      entity,
      rows.map((row) => ({ ...row })),
    ]);
  }

  private restore(snapshot: Array<[Function, Row[]]>): void {
    this.tables.clear();
    for (const [entity, rows] of snapshot) {
      const restored = rows.map((row) =>
        Object.assign(new (entity as EntityConstructor)(), row),
      );
      this.tables.set(entity, restored);
    }
  }
}
