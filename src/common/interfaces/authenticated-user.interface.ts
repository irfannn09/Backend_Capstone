import { UserRole } from '../enums';

/** Objek yang dipasang ke request.user oleh JwtAuthGuard. */
export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  mustChangePassword: boolean;
}
