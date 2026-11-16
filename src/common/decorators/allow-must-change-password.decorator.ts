import { SetMetadata } from '@nestjs/common';

export const ALLOW_MUST_CHANGE_PASSWORD_KEY = 'allowMustChangePassword';
/**
 * User dengan must_change_password = true hanya boleh memanggil endpoint
 * yang diberi decorator ini (change-password, me).
 */
export const AllowMustChangePassword = () =>
  SetMetadata(ALLOW_MUST_CHANGE_PASSWORD_KEY, true);
