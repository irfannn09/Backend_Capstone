import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../enums';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

export function isOwner(resourceUserId: string, user: AuthenticatedUser): boolean {
  return resourceUserId === user.userId;
}

/**
 * Pastikan user adalah pemilik resource (resource.user_id === request.user.userId),
 * atau memiliki salah satu role yang diizinkan melihat data milik orang lain.
 * CATATAN: belum dipakai oleh modul borrowings (Sprint 8 memeriksa kepemilikan langsung di
 * service dan membalas 404 agar keberadaan resource tidak bocor). Disiapkan untuk modul
 * berikutnya yang memerlukan pola 403; boleh dipakai atau dihapus saat Sprint 9+ dirancang.
 */
export function assertOwnerOrRole(
  resourceUserId: string,
  user: AuthenticatedUser,
  allowedRoles: UserRole[] = [],
): void {
  if (isOwner(resourceUserId, user) || allowedRoles.includes(user.role)) return;
  throw new ForbiddenException('Anda tidak berhak mengakses data ini');
}
