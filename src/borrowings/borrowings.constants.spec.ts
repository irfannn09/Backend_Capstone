import {
  approvalDeadline,
  isPastApprovalDeadline,
  isPastNoShowDeadline,
  NO_SHOW_GRACE_MS,
  noShowCutoff,
  noShowDeadline,
} from './borrowings.constants';

const at = (iso: string) => new Date(iso);

describe('aturan waktu borrowings', () => {
  describe('approval deadline tetap 2 jam', () => {
    const createdAt = at('2026-11-13T07:00:00.000Z');

    it('deadline = created_at + 2 jam', () => {
      expect(approvalDeadline(createdAt).toISOString()).toBe(
        '2026-11-13T09:00:00.000Z',
      );
    });

    it('tepat 2 jam masih boleh diproses; lewat 1 ms baru EXPIRED', () => {
      expect(
        isPastApprovalDeadline(createdAt, at('2026-11-13T09:00:00.000Z')),
      ).toBe(false);
      expect(
        isPastApprovalDeadline(createdAt, at('2026-11-13T09:00:00.001Z')),
      ).toBe(true);
    });
  });

  describe('no-show = start_at + 30 menit (inklusif)', () => {
    const startAt = at('2026-11-13T08:00:00.000Z');

    it('grace period tepat 30 menit', () => {
      expect(NO_SHOW_GRACE_MS).toBe(30 * 60 * 1000);
      expect(noShowDeadline(startAt).toISOString()).toBe(
        '2026-11-13T08:30:00.000Z',
      );
    });

    it('08:29:59 masih APPROVED', () => {
      expect(
        isPastNoShowDeadline(startAt, at('2026-11-13T08:29:59.000Z')),
      ).toBe(false);
    });

    it('08:30:00 tepat di batas sudah EXPIRED', () => {
      expect(
        isPastNoShowDeadline(startAt, at('2026-11-13T08:30:00.000Z')),
      ).toBe(true);
    });

    it('08:30:01 EXPIRED', () => {
      expect(
        isPastNoShowDeadline(startAt, at('2026-11-13T08:30:01.000Z')),
      ).toBe(true);
    });

    it('cutoff query = now - 30 menit', () => {
      expect(noShowCutoff(at('2026-11-13T08:30:00.000Z')).toISOString()).toBe(
        '2026-11-13T08:00:00.000Z',
      );
    });
  });

  describe('future booking tidak dianggap no-show sebelum start_at', () => {
    // Request dibuat Jumat, jadwal Sabtu 08:00-12:00.
    const startAt = at('2026-11-14T08:00:00.000Z');

    it('Jumat -> tetap APPROVED', () => {
      expect(
        isPastNoShowDeadline(startAt, at('2026-11-13T10:00:00.000Z')),
      ).toBe(false);
    });

    it('Sabtu 08:00 -> grace period mulai, masih APPROVED', () => {
      expect(
        isPastNoShowDeadline(startAt, at('2026-11-14T08:00:00.000Z')),
      ).toBe(false);
    });

    it('Sabtu 08:29:59 -> masih APPROVED', () => {
      expect(
        isPastNoShowDeadline(startAt, at('2026-11-14T08:29:59.000Z')),
      ).toBe(false);
    });

    it('Sabtu 08:30:00 -> EXPIRED bila handover belum ada', () => {
      expect(
        isPastNoShowDeadline(startAt, at('2026-11-14T08:30:00.000Z')),
      ).toBe(true);
    });
  });
});
