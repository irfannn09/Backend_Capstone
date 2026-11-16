import { UserRole } from '../common/enums';

/** SAPRAS mengelola inventaris & stok. ADMIN hanya memantau (read-only). */
export const INVENTORY_WRITE_ROLES: UserRole[] = [UserRole.SAPRAS];
export const INVENTORY_READ_ROLES: UserRole[] = [UserRole.SAPRAS, UserRole.ADMIN];
