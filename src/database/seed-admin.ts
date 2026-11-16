import 'dotenv/config';
import { DataSource } from 'typeorm';
import { UserRole } from '../common/enums';
import { hashPassword } from '../common/utils/password.util';
import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { buildDataSourceOptions } from './typeorm.config';

/**
 * Membuat ADMIN awal (satu-satunya cara membuat admin; tidak ada endpoint publik).
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (min 8), SEED_ADMIN_NAME (opsional)
 * Idempotent: bila email sudah ada, tidak melakukan apa pun.
 * Admin awal diwajibkan mengganti password saat login pertama.
 */
async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Administrator';

  if (!email || !email.includes('@')) {
    throw new Error('SEED_ADMIN_EMAIL belum diisi / tidak valid (isi di file .env)');
  }
  if (!password || password.length < 8 || password.length > 72) {
    throw new Error('SEED_ADMIN_PASSWORD wajib diisi (8-72 karakter) (isi di file .env)');
  }

  const dataSource = new DataSource(buildDataSourceOptions(process.env));
  await dataSource.initialize();
  try {
    const role = await dataSource.getRepository(Role).findOneBy({ name: UserRole.ADMIN });
    if (!role) throw new Error('Role ADMIN belum ada. Jalankan dulu: npm run migration:run');

    const users = dataSource.getRepository(User);
    if (await users.existsBy({ email })) {
      console.log(`Admin dengan email ${email} sudah ada. Tidak ada perubahan.`);
      return;
    }
    await users.save(
      users.create({
        roleId: role.id,
        name,
        email,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        isActive: true,
      }),
    );
    console.log(`Admin dibuat: ${email} (wajib ganti password saat login pertama).`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: Error) => {
  console.error(`Seed gagal: ${error.message}`);
  process.exit(1);
});
