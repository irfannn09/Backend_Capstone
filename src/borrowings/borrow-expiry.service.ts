import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThanOrEqual, Repository } from 'typeorm';
import { BookingStatus, BorrowRequestStatus } from '../common/enums';
import { HandoverRecord } from '../handovers/entities/handover-record.entity';
import {
  APPROVAL_WINDOW_MS,
  BLOCKING_BOOKING_STATUSES,
  noShowCutoff,
} from './borrowings.constants';
import { BorrowRequest } from './entities/borrow-request.entity';
import { ItemBooking } from './entities/item-booking.entity';

/**
 * Dua aturan kedaluwarsa yang TERPISAH:
 *  1. Approval: request WAITING_APPROVAL melewati created_at + 2 jam -> EXPIRED.
 *  2. No-show: request APPROVED yang belum diserahkan sampai start_at + 30 menit -> EXPIRED.
 *
 * item_bookings.expires_at TETAP berarti deadline approval 2 jam; bukan no-show.
 *
 * Dua mekanisme: (1) dipanggil di awal setiap operasi baca/tulis request (lazy, akurat),
 * (2) sapuan berkala di latar belakang agar status di database ikut rapi.
 * Idempotent, jadi aman dijalankan bersamaan oleh beberapa instance.
 */
@Injectable()
export class BorrowExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BorrowExpiryService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(BorrowRequest)
    private readonly requests: Repository<BorrowRequest>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = parseInt(
      this.config.get<string>('EXPIRY_SWEEP_INTERVAL_MS') ?? '60000',
      10,
    );
    if (interval > 0) {
      this.timer = setInterval(() => {
        this.expireOverdue().catch((e: Error) =>
          this.logger.error(`Sweep gagal: ${e.message}`),
        );
      }, interval);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Waktu acuan = waktu server (bukan client). Mengembalikan jumlah request yang diubah. */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const approvalExpired = await this.expireWaitingApproval(now);
    const noShowExpired = await this.expireNoShow(now);
    return approvalExpired + noShowExpired;
  }

  /**
   * Lepas seluruh booking yang masih memblokir untuk request tertentu.
   * `expires_at` tidak diubah (tetap deadline approval 2 jam).
   * Dipakai bersama oleh sapuan no-show dan branch inline no-show di handover.
   */
  async releaseBlockingBookings(
    manager: EntityManager,
    requestIds: string[],
  ): Promise<void> {
    if (!requestIds.length) return;
    await manager.update(
      ItemBooking,
      { requestId: In(requestIds), status: In(BLOCKING_BOOKING_STATUSES) },
      { status: BookingStatus.EXPIRED },
    );
  }

  /** Approval deadline: created_at + 2 jam (tepat di deadline masih boleh diproses). */
  private async expireWaitingApproval(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - APPROVAL_WINDOW_MS);
    const result = await this.requests
      .createQueryBuilder()
      .update(BorrowRequest)
      .set({ status: BorrowRequestStatus.EXPIRED })
      .where('status = :status AND created_at < :cutoff', {
        status: BorrowRequestStatus.WAITING_APPROVAL,
        cutoff,
      })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * No-show: APPROVED dan now >= start_at + 30 menit, TANPA handover tercatat.
   * Booking terkait ikut dilepas (EXPIRED) agar unit tidak lagi menahan ketersediaan.
   * Request future booking tidak tersentuh karena start_at belum lewat.
   */
  private async expireNoShow(now: Date): Promise<number> {
    // start_at <= now - 30 menit  <=>  now >= start_at + 30 menit (inklusif).
    const cutoff = noShowCutoff(now);

    return this.dataSource.transaction(async (manager) => {
      const candidates = await manager.find(BorrowRequest, {
        where: {
          status: BorrowRequestStatus.APPROVED,
          startAt: LessThanOrEqual(cutoff),
        },
        lock: { mode: 'pessimistic_write' },
      });
      const ids = candidates.map((row) => row.id);
      if (!ids.length) return 0;

      // Handover yang sudah tercatat/terkonfirmasi membatalkan no-show.
      const handovers = await manager.find(HandoverRecord, {
        where: { requestId: In(ids) },
        select: { requestId: true },
      });
      const handedOver = new Set(handovers.map((row) => row.requestId));
      const expiredIds = ids.filter((id) => !handedOver.has(id));
      if (!expiredIds.length) return 0;

      await manager.update(
        BorrowRequest,
        { id: In(expiredIds) },
        { status: BorrowRequestStatus.EXPIRED },
      );
      // Lepas booking agar unit tidak lagi menahan ketersediaan.
      await this.releaseBlockingBookings(manager, expiredIds);
      return expiredIds.length;
    });
  }
}
