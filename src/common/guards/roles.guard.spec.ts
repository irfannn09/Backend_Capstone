import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../enums';
import { RolesGuard } from './roles.guard';

function ctx(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
function guardRequiring(roles?: UserRole[]) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(roles) } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('tanpa @Roles -> semua user terautentikasi boleh', () => {
    expect(guardRequiring(undefined).canActivate(ctx({ role: UserRole.SISWA }))).toBe(true);
  });
  it('role cocok -> lolos', () => {
    expect(guardRequiring([UserRole.SAPRAS]).canActivate(ctx({ role: UserRole.SAPRAS }))).toBe(true);
  });
  it('ADMIN TIDAK otomatis lolos endpoint SAPRAS', () => {
    expect(() => guardRequiring([UserRole.SAPRAS]).canActivate(ctx({ role: UserRole.ADMIN }))).toThrow(ForbiddenException);
  });
  it('tanpa user di request -> ditolak', () => {
    expect(() => guardRequiring([UserRole.ADMIN]).canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});
