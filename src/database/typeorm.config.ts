import { join } from 'path';
import { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';

export type DbEnv = Record<string, string | undefined>;

/**
 * Satu sumber konfigurasi untuk aplikasi (DatabaseModule) dan TypeORM CLI (data-source.ts).
 * synchronize SELALU false: schema dikelola lewat migration.
 */
export function buildDataSourceOptions(env: DbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST ?? 'localhost',
    port: parseInt(env.DB_PORT ?? '5432', 10),
    username: env.DB_USERNAME ?? 'postgres',
    password: env.DB_PASSWORD ?? '',
    database: env.DB_DATABASE ?? 'inventarisMuhamka',
    entities: ENTITIES,
    migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
    synchronize: false,
    migrationsRun: false,
    // gen_random_uuid() bawaan PostgreSQL (extension pgcrypto) untuk default PK UUID.
    uuidExtension: 'pgcrypto',
    // DB_LOGGING=false dipakai test e2e agar penolakan constraint yang disengaja tidak memenuhi console.
    logging: env.DB_LOGGING === 'false' ? false : ['error', 'warn', 'migration'],
  };
}
