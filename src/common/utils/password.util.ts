import * as bcrypt from 'bcryptjs';

function rounds(): number {
  const n = parseInt(process.env.BCRYPT_ROUNDS ?? '', 10);
  return Number.isInteger(n) && n >= 4 && n <= 15 ? n : 10;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, rounds());
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: string | undefined;
/** Hash palsu untuk menyamakan waktu respons saat user tidak ditemukan (anti user-enumeration). */
export async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  return dummyHash;
}
