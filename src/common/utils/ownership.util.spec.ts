import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../enums';
import { assertOwnerOrRole, isOwner } from './ownership.util';

const user = (userId: string, role = UserRole.SISWA) => ({ userId, role, mustChangePassword: false });

describe('ownership util', () => {
  it('pemilik lolos, bukan pemilik ditolak', () => {
    expect(isOwner('a', user('a'))).toBe(true);
    expect(() => assertOwnerOrRole('a', user('a'))).not.toThrow();
    expect(() => assertOwnerOrRole('a', user('b'))).toThrow(ForbiddenException);
  });
  it('role yang diizinkan boleh mengakses data orang lain', () => {
    expect(() => assertOwnerOrRole('a', user('b', UserRole.SAPRAS), [UserRole.SAPRAS])).not.toThrow();
    expect(() => assertOwnerOrRole('a', user('b', UserRole.ADMIN), [UserRole.SAPRAS])).toThrow(ForbiddenException);
  });
});
