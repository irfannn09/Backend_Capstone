/**
 * Test e2e memakai database TERPISAH agar data development tidak tersentuh.
 * Default: <DB_DATABASE>_test, atau isi DB_DATABASE_TEST di .env.
 */
export function resolveTestDatabase(): string {
  const dev = process.env.DB_DATABASE ?? 'inventarisMuhamka';
  const test = process.env.DB_DATABASE_TEST ?? `${dev}_test`;
  if (test === dev) {
    throw new Error('DB_DATABASE_TEST tidak boleh sama dengan DB_DATABASE (database development).');
  }
  return test;
}
