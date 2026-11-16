import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUniqueConstraints1794106238158 implements MigrationInterface {
    name = 'AddUniqueConstraints1794106238158'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "item_categories" ADD CONSTRAINT "UQ_88b385fb344dc44577a3f9e6a76" UNIQUE ("name")`);
        await queryRunner.query(`ALTER TABLE "locations" ADD CONSTRAINT "UQ_227023051ab1fedef7a3b6c7e2a" UNIQUE ("name")`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`);
        await queryRunner.query(`ALTER TABLE "item_types" ADD CONSTRAINT "UQ_item_types_category_name" UNIQUE ("category_id", "name")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "item_types" DROP CONSTRAINT "UQ_item_types_category_name"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"`);
        await queryRunner.query(`ALTER TABLE "locations" DROP CONSTRAINT "UQ_227023051ab1fedef7a3b6c7e2a"`);
        await queryRunner.query(`ALTER TABLE "item_categories" DROP CONSTRAINT "UQ_88b385fb344dc44577a3f9e6a76"`);
    }

}
