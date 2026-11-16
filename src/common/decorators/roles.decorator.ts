import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../enums';

export const ROLES_KEY = 'roles';
/** Batasi endpoint ke role tertentu. Tanpa @Roles, semua user terautentikasi boleh. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
