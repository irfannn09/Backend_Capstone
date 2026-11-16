import { MigrationInterface, QueryRunner } from 'typeorm';

export class NullableItemBookingUnit1794124000000 implements MigrationInterface {
  name = 'NullableItemBookingUnit1794124000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "item_bookings" ALTER COLUMN "inventory_unit_id" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "item_bookings" WHERE "inventory_unit_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_bookings" ALTER COLUMN "inventory_unit_id" SET NOT NULL`,
    );
  }
}
