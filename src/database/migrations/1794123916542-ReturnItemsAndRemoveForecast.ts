import { MigrationInterface, QueryRunner } from "typeorm";

export class ReturnItemsAndRemoveForecast1794123916542 implements MigrationInterface {
    name = 'ReturnItemsAndRemoveForecast1794123916542'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- Hapus forecasting (konsep digantikan klasifikasi AI). ---
        // Catatan: TypeORM tidak men-generate DROP untuk tabel yang tidak lagi punya entity,
        // sehingga bagian ini ditulis manual. Seluruh data forecast_results ikut hilang.
        await queryRunner.query(`ALTER TABLE "forecast_results" DROP CONSTRAINT "FK_1f623af6c0b28c3d25cbe4da6b5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_forecast_results_item_period"`);
        await queryRunner.query(`DROP TABLE "forecast_results"`);

        await queryRunner.query(`CREATE TYPE "public"."return_items_return_condition_enum" AS ENUM('LAYAK_PAKAI', 'PERLU_DIPERBAIKI', 'RUSAK_TOTAL')`);
        await queryRunner.query(`CREATE TABLE "return_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "return_id" uuid NOT NULL, "handover_item_id" uuid NOT NULL, "return_condition" "public"."return_items_return_condition_enum" NOT NULL, "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_return_items_return_handover_item" UNIQUE ("return_id", "handover_item_id"), CONSTRAINT "PK_6e6c1db00d31ab59c1bc22f6cb9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5330b49ddea694c12ad2ae6782" ON "return_items" ("handover_item_id") `);
        await queryRunner.query(`ALTER TABLE "return_items" ADD CONSTRAINT "FK_afc80619fe38ae5911b464af463" FOREIGN KEY ("return_id") REFERENCES "return_records"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "return_items" ADD CONSTRAINT "FK_5330b49ddea694c12ad2ae6782f" FOREIGN KEY ("handover_item_id") REFERENCES "handover_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "return_items" DROP CONSTRAINT "FK_5330b49ddea694c12ad2ae6782f"`);
        await queryRunner.query(`ALTER TABLE "return_items" DROP CONSTRAINT "FK_afc80619fe38ae5911b464af463"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5330b49ddea694c12ad2ae6782"`);
        await queryRunner.query(`DROP TABLE "return_items"`);
        await queryRunner.query(`DROP TYPE "public"."return_items_return_condition_enum"`);

        // --- Pulihkan struktur forecast_results (hanya struktur; datanya tidak dapat dipulihkan). ---
        await queryRunner.query(`CREATE TABLE "forecast_results" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "item_type_id" uuid NOT NULL, "forecast_period" date NOT NULL, "predicted_quantity" numeric(12,2) NOT NULL, "risk_level" character varying(30) NOT NULL, "recommendation" text, CONSTRAINT "PK_b1f71db62cbb629da10d0fbbcdb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_forecast_results_item_period" ON "forecast_results" ("item_type_id", "forecast_period") `);
        await queryRunner.query(`ALTER TABLE "forecast_results" ADD CONSTRAINT "FK_1f623af6c0b28c3d25cbe4da6b5" FOREIGN KEY ("item_type_id") REFERENCES "item_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

}
