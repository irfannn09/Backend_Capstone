import { AvailabilityStatus, BookingStatus } from '../common/enums';

/** Batas waktu keputusan Sapras sejak request dibuat. */
export const APPROVAL_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Grace period no-show sejak start_at untuk request APPROVED.
 * No-show adalah aturan terpisah dari deadline approval 2 jam.
 */
export const NO_SHOW_GRACE_MS = 30 * 60 * 1000;

/** Toleransi jam mulai yang sedikit di masa lalu (selisih jam client/server, latensi submit). */
export const START_TOLERANCE_MS = 5 * 60 * 1000;

/** Booking yang memblokir unit pada rentang waktunya. */
export const BLOCKING_BOOKING_STATUSES = [
  BookingStatus.ACTIVE,
  BookingStatus.APPROVED,
];

/** Unit dengan status ini tidak dapat dipinjam/di-booking. */
export const UNUSABLE_AVAILABILITY = [
  AvailabilityStatus.REPAIR,
  AvailabilityStatus.UNAVAILABLE,
];

/** Deadline approval = created_at + 2 jam (dihitung, tidak disimpan). */
export function approvalDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + APPROVAL_WINDOW_MS);
}

/** Lewat deadline bila SEKARANG > created_at + 2 jam (tepat di deadline masih valid). */
export function isPastApprovalDeadline(createdAt: Date, now: Date): boolean {
  return now.getTime() > approvalDeadline(createdAt).getTime();
}

/** Deadline no-show = start_at + 30 menit (dihitung, tidak disimpan). */
export function noShowDeadline(startAt: Date): Date {
  return new Date(startAt.getTime() + NO_SHOW_GRACE_MS);
}

/**
 * No-show bila now >= start_at + 30 menit.
 * Tepat di deadline SUDAH dianggap no-show (08:30:00 -> EXPIRED).
 */
export function isPastNoShowDeadline(startAt: Date, now: Date): boolean {
  return now.getTime() >= noShowDeadline(startAt).getTime();
}

/**
 * Batas start_at yang sudah melewati grace period: start_at <= now - 30 menit.
 * Ekuivalen dengan now >= start_at + 30 menit untuk query database.
 */
export function noShowCutoff(now: Date): Date {
  return new Date(now.getTime() - NO_SHOW_GRACE_MS);
}
