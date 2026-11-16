import { ConfigService } from '@nestjs/config';
import { DataSource, FindOperator, Repository } from 'typeorm';
import { BookingStatus, BorrowRequestStatus } from '../common/enums';
import { HandoverRecord } from '../handovers/entities/handover-record.entity';
import { BorrowExpiryService } from './borrow-expiry.service';
import {
  APPROVAL_WINDOW_MS,
  BLOCKING_BOOKING_STATUSES,
} from './borrowings.constants';
import { BorrowRequest } from './entities/borrow-request.entity';
import { ItemBooking } from './entities/item-booking.entity';

const at = (iso: string) => new Date(iso);

/** Mock ringan: fokus pada keputusan status, bukan SQL. */
function setup() {
  const approvalUpdate = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  };
  const requests = {
    createQueryBuilder: jest.fn(() => approvalUpdate),
  } as unknown as Repository<BorrowRequest>;

  const manager = {
    find: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: typeof manager) => Promise<number>) =>
      cb(manager),
    ),
  } as unknown as DataSource;
  const config = { get: jest.fn(() => '0') } as unknown as ConfigService;

  const service = new BorrowExpiryService(requests, dataSource, config);
  return { service, manager, approvalUpdate };
}

const findCriteria = (call: unknown[]): Record<string, FindOperator<unknown>> =>
  (call[1] as { where: Record<string, FindOperator<unknown>> }).where;

describe('BorrowExpiryService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('approval deadline 2 jam', () => {
    it('WAITING_APPROVAL lewat created_at + 2 jam tetap menjadi EXPIRED', async () => {
      const { service, approvalUpdate, manager } = setup();
      approvalUpdate.execute.mockResolvedValueOnce({ affected: 2 });
      manager.find.mockResolvedValueOnce([]); // tidak ada request APPROVED

      const now = at('2026-11-13T10:00:00.000Z');
      expect(await service.expireOverdue(now)).toBe(2);
      expect(approvalUpdate.where).toHaveBeenCalledWith(
        'status = :status AND created_at < :cutoff',
        {
          status: BorrowRequestStatus.WAITING_APPROVAL,
          cutoff: new Date(now.getTime() - APPROVAL_WINDOW_MS),
        },
      );
      expect(manager.update).not.toHaveBeenCalled();
    });
  });

  describe('no-show 30 menit', () => {
    it('08:29:59 belum lewat cutoff -> tetap APPROVED', async () => {
      const { service, manager } = setup();
      manager.find.mockResolvedValueOnce([]); // query tidak mengembalikan kandidat

      const now = at('2026-11-13T08:29:59.000Z');
      expect(await service.expireOverdue(now)).toBe(0);

      const where = findCriteria(manager.find.mock.calls[0]);
      expect(where.status).toBe(BorrowRequestStatus.APPROVED);
      expect(where.startAt.value).toEqual(at('2026-11-13T07:59:59.000Z'));
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('08:30:00 tepat di batas -> EXPIRED dan booking dilepas', async () => {
      const { service, manager } = setup();
      manager.find
        .mockResolvedValueOnce([{ id: 'req-1' }]) // kandidat no-show
        .mockResolvedValueOnce([]); // belum ada handover

      const now = at('2026-11-13T08:30:00.000Z');
      expect(await service.expireOverdue(now)).toBe(1);

      const [, requestCriteria, requestPatch] = manager.update.mock
        .calls[0] as [
        unknown,
        { id: FindOperator<string[]> },
        { status: string },
      ];
      expect(manager.update.mock.calls[0][0]).toBe(BorrowRequest);
      expect(requestCriteria.id.value as string[]).toEqual(['req-1']);
      expect(requestPatch).toEqual({ status: BorrowRequestStatus.EXPIRED });

      expect(manager.update.mock.calls[1][0]).toBe(ItemBooking);
      expect(manager.update.mock.calls[1][2]).toEqual({
        status: BookingStatus.EXPIRED,
      });
      const bookingCriteria = manager.update.mock.calls[1][1] as {
        requestId: FindOperator<string[]>;
        status: FindOperator<string[]>;
      };
      expect(bookingCriteria.requestId.value).toEqual(['req-1']);
      expect(bookingCriteria.status.value).toEqual(BLOCKING_BOOKING_STATUSES);
    });

    it('08:30:01 -> EXPIRED', async () => {
      const { service, manager } = setup();
      manager.find
        .mockResolvedValueOnce([{ id: 'req-1' }])
        .mockResolvedValueOnce([]);

      expect(await service.expireOverdue(at('2026-11-13T08:30:01.000Z'))).toBe(
        1,
      );
      expect(manager.update.mock.calls[0][2]).toEqual({
        status: BorrowRequestStatus.EXPIRED,
      });
    });

    it('handover sudah tercatat -> JANGAN expire sebagai no-show', async () => {
      const { service, manager } = setup();
      manager.find
        .mockResolvedValueOnce([{ id: 'req-1' }])
        .mockResolvedValueOnce([{ requestId: 'req-1' }]);

      expect(await service.expireOverdue(at('2026-11-13T09:00:00.000Z'))).toBe(
        0,
      );
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.find.mock.calls[1][0]).toBe(HandoverRecord);
    });

    it('future booking pada Jumat -> tidak ada kandidat, tetap APPROVED', async () => {
      const { service, manager } = setup();
      manager.find.mockResolvedValueOnce([]); // Sabtu 08:00 belum masuk cutoff Jumat

      const now = at('2026-11-13T10:00:00.000Z');
      expect(await service.expireOverdue(now)).toBe(0);

      const where = findCriteria(manager.find.mock.calls[0]);
      expect(where.startAt.value).toEqual(at('2026-11-13T09:30:00.000Z'));
      // start_at Sabtu 08:00 > cutoff Jumat 09:30 -> belum no-show
      expect(at('2026-11-14T08:00:00.000Z').getTime()).toBeGreaterThan(
        (where.startAt.value as Date).getTime(),
      );
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('Sabtu 08:30:00 -> EXPIRED bila handover belum ada', async () => {
      const { service, manager } = setup();
      manager.find
        .mockResolvedValueOnce([{ id: 'req-sabtu' }])
        .mockResolvedValueOnce([]);

      expect(await service.expireOverdue(at('2026-11-14T08:30:00.000Z'))).toBe(
        1,
      );
      expect(manager.update.mock.calls[0][2]).toEqual({
        status: BorrowRequestStatus.EXPIRED,
      });
    });

    it('hanya melepas booking yang masih memblokir (ACTIVE/APPROVED)', async () => {
      const { service, manager } = setup();
      manager.find
        .mockResolvedValueOnce([{ id: 'req-1' }])
        .mockResolvedValueOnce([]);

      await service.expireOverdue(at('2026-11-13T08:30:00.000Z'));
      const criteria = manager.update.mock.calls[1][1] as {
        status: FindOperator<string[]>;
      };
      expect(criteria.status.value).toEqual([
        BookingStatus.ACTIVE,
        BookingStatus.APPROVED,
      ]);
    });
  });
});
