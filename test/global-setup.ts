import 'dotenv/config';
import { execSync } from 'child_process';
import { join } from 'path';
import { Client } from 'pg';
import { resolveTestDatabase } from './test-config';

/** Membuat database test (jika belum ada) lalu menjalankan semua migration. */
export default async function globalSetup(): Promise<void> {
  const testDb = resolveTestDatabase();

  const admin = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: 'postgres',
  });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testDb]);
    if (!exists.rowCount) {
      await admin.query(`CREATE DATABASE "${testDb.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }

  execSync('npm run migration:run', {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DB_DATABASE: testDb },
    stdio: 'pipe',
  });
}
