import { comparePassword, hashPassword } from './password.util';

describe('password util (bcrypt)', () => {
  beforeAll(() => { process.env.BCRYPT_ROUNDS = '4'; });
  it('hash bukan plaintext, dapat diverifikasi, dan salt berbeda', async () => {
    const a = await hashPassword('Rahasia123');
    const b = await hashPassword('Rahasia123');
    expect(a).not.toContain('Rahasia123');
    expect(a).toMatch(/^\$2[aby]\$/);
    expect(a).not.toBe(b);
    expect(await comparePassword('Rahasia123', a)).toBe(true);
    expect(await comparePassword('salah', a)).toBe(false);
  });
});
