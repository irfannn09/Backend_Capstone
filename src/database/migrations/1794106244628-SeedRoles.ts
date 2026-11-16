import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Data referensi: 4 role final. Idempotent (aman dijalankan ulang).
 * down() gagal (FK RESTRICT) bila masih ada user yang memakai role tersebut - ini disengaja.
 */
export class SeedRoles1794106244628 implements MigrationInterface {
  name = 'SeedRoles1794106244628';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "roles" ("name", "description") VALUES
        ('ADMIN',  'Mengelola user, master data, dan monitoring'),
        ('SAPRAS', 'Mengelola inventaris, stok, perbaikan, approval, handover, dan return'),
        ('GURU',   'Meminjam barang dan melihat riwayat'),
        ('SISWA',  'Meminjam barang dan melihat riwayat')
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "roles" WHERE "name" IN ('ADMIN', 'SAPRAS', 'GURU', 'SISWA')`,
    );
  }
}
