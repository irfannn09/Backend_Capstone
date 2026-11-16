import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { DataSource, FindOptionsRelations, In, MoreThanOrEqual, Repository } from 'typeorm';
import { Paginated, toPaginated } from '../common/dto/pagination-query.dto';
import {
  BookingStatus,
  BorrowRequestStatus,
  FaceVerificationStatus,
  UserRole,
} from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { getPgErrorCode } from '../common/utils/pg-error.util';
import { FaceVerificationService } from '../face/face-verification.service';
import { FaceVerification } from '../face/entities/face-verification.entity';
import { ItemType } from '../master-data/entities/item-type.entity';
import { AvailabilityService } from './availability.service';
import { BorrowExpiryService } from './borrow-expiry.service';
import {
  APPROVAL_WINDOW_MS,
  START_TOLERANCE_MS,
  isPastApprovalDeadline,
} from './borrowings.constants';
import { ListBorrowRequestsQueryDto } from './dto/borrow-request-query.dto';
import { BorrowRequestResponseDto } from './dto/borrow-request-response.dto';
import { CreateBorrowRequestDto } from './dto/create-borrow-request.dto';
import { BorrowRequestItem } from './entities/borrow-request-item.entity';
import { BorrowRequest } from './entities/borrow-request.entity';
import { ItemBooking } from './entities/item-booking.entity';

const FULL_RELATIONS: FindOptionsRelations<BorrowRequest> = {
  user: { profile: true },
  items: { itemType: true },
  bookings: { inventoryUnit: true },
  faceVerifications: true,
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class BorrowRequestsService {
  private readonly logger = new Logger(BorrowRequestsService.name);

  constructor(
    @InjectRepository(BorrowRequest) private readonly requests: Repository<BorrowRequest>,
    @InjectRepository(ItemType) private readonly itemTypes: Repository<ItemType>,
    private readonly dataSource: DataSource,
    private readonly availability: AvailabilityService,
    private readonly faceVerification: FaceVerificationService,
    private readonly expiry: BorrowExpiryService,
  ) {}

  // ------------------------------------------------------------------ create
  /**
   * Alur: validasi -> verifikasi wajah -> (transaksi atomik) cek ketersediaan,
   * simpan request + semua item + catatan verifikasi.
   * Bila verifikasi wajah gagal, TIDAK ada satu pun baris yang dibuat.
   */
  async create(user: AuthenticatedUser, dto: CreateBorrowRequestDto): Promise<BorrowRequestResponseDto> {
    const now = new Date();
    const window = this.parseWindow(dto.startAt, dto.endAt, now);

    const typeIds = dto.items.map((i) => i.itemTypeId);
    if (new Set(typeIds).size !== typeIds.length) {
      throw new BadRequestException('Satu tipe barang hanya boleh muncul sekali dalam keranjang; gabungkan jumlahnya');
    }
    const found = await this.itemTypes.find({ where: { id: In(typeIds) } });
    const missing = typeIds.filter((id) => !found.some((t) => t.id === id));
    if (missing.length) {
      throw new NotFoundException(`Tipe barang tidak ditemukan: ${missing.join(', ')}`);
    }

    // Wajib untuk semua jenis barang (PER_UNIT maupun CONSUMABLE).
    const outcome = await this.faceVerification.verify(user.userId, dto.faceImage);
    if (!outcome.success) {
      this.logger.warn(`Verifikasi wajah gagal untuk user ${user.userId}; request tidak dibuat`);
      throw new UnprocessableEntityException({
        message: 'Verifikasi wajah gagal. Permintaan peminjaman tidak dibuat.',
        code: 'FACE_VERIFICATION_FAILED',
      });
    }

    const requestId = await this.withCodeRetry(() =>
      this.dataSource.transaction(async (manager) => {
        // Serialisasi submit untuk tipe barang yang sama agar pengecekan kuota akurat.
        for (const id of [...typeIds].sort()) {
          await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
        }
        await this.availability.assertAvailable(
          manager,
          dto.items.map((i) => ({ itemTypeId: i.itemTypeId, quantity: i.quantity })),
          window,
          now,
        );

        const request = await manager.save(
          manager.create(BorrowRequest, {
            userId: user.userId,
            requestCode: this.generateCode(now),
            startAt: window.startAt,
            endAt: window.endAt,
            purpose: dto.purpose,
            status: BorrowRequestStatus.WAITING_APPROVAL,
          }),
        );
        await manager.save(
          dto.items.map((i) =>
            manager.create(BorrowRequestItem, {
              requestId: request.id,
              itemTypeId: i.itemTypeId,
              quantityRequested: i.quantity,
              notes: i.notes ?? null,
            }),
          ),
        );
        await manager.save(
          manager.create(FaceVerification, {
            userId: user.userId,
            requestId: request.id,
            status: FaceVerificationStatus.SUCCESS,
            verifiedAt: new Date(),
          }),
        );
        return request.id;
      }),
    );

    return this.findOne(user, requestId);
  }

  // -------------------------------------------------------------------- read
  /** Siswa/Guru: hanya miliknya. Sapras: semua. */
  async list(user: AuthenticatedUser, query: ListBorrowRequestsQueryDto): Promise<Paginated<BorrowRequestResponseDto>> {
    await this.expiry.expireOverdue();
    const [rows, total] = await this.requests.findAndCount({
      where: {
        ...(user.role === UserRole.SAPRAS ? {} : { userId: user.userId }),
        ...(query.status ? { status: query.status } : {}),
      },
      relations: FULL_RELATIONS,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return toPaginated(rows.map(BorrowRequestResponseDto.from), total, query.page, query.limit);
  }

  /** Antrean Sapras: menunggu keputusan & belum lewat deadline, yang terlama dulu. */
  async listPending(query: ListBorrowRequestsQueryDto): Promise<Paginated<BorrowRequestResponseDto>> {
    const now = new Date();
    await this.expiry.expireOverdue(now);
    const [rows, total] = await this.requests.findAndCount({
      where: {
        status: BorrowRequestStatus.WAITING_APPROVAL,
        createdAt: MoreThanOrEqual(new Date(now.getTime() - APPROVAL_WINDOW_MS)),
      },
      relations: FULL_RELATIONS,
      order: { createdAt: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return toPaginated(rows.map(BorrowRequestResponseDto.from), total, query.page, query.limit);
  }

  /** Non-pemilik (selain Sapras) mendapat 404 agar keberadaan request tidak bocor. */
  async findOne(user: AuthenticatedUser, id: string): Promise<BorrowRequestResponseDto> {
    await this.expiry.expireOverdue();
    const request = await this.requests.findOne({ where: { id }, relations: FULL_RELATIONS });
    if (!request || (user.role !== UserRole.SAPRAS && request.userId !== user.userId)) {
      throw new NotFoundException('Request peminjaman tidak ditemukan');
    }
    return BorrowRequestResponseDto.from(request);
  }

  // ------------------------------------------------------------------ cancel
  /** Pemilik dapat membatalkan saat WAITING_APPROVAL atau APPROVED (booking dilepas). */
  async cancel(user: AuthenticatedUser, id: string): Promise<BorrowRequestResponseDto> {
    await this.expiry.expireOverdue();

    const outcome = await this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(BorrowRequest, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request || request.userId !== user.userId) {
        throw new NotFoundException('Request peminjaman tidak ditemukan');
      }

      if (request.status === BorrowRequestStatus.EXPIRED) return 'expired' as const;

      if (request.status === BorrowRequestStatus.WAITING_APPROVAL) {
        if (isPastApprovalDeadline(request.createdAt, new Date())) {
          request.status = BorrowRequestStatus.EXPIRED;
          await manager.save(request);
          return 'expired' as const;
        }
      } else if (request.status !== BorrowRequestStatus.APPROVED) {
        throw new ConflictException({
          message: `Request berstatus ${request.status} dan tidak dapat dibatalkan`,
          code: 'INVALID_STATUS',
        });
      }

      // Lepas booking agar unit bisa dipakai request lain.
      await manager.update(
        ItemBooking,
        { requestId: id, status: In([BookingStatus.ACTIVE, BookingStatus.APPROVED]) },
        { status: BookingStatus.CANCELLED },
      );
      request.status = BorrowRequestStatus.CANCELLED;
      await manager.save(request);
      return 'cancelled' as const;
    });

    if (outcome === 'expired') {
      throw new ConflictException({
        message: 'Request sudah melewati batas waktu approval (2 jam) dan berstatus EXPIRED',
        code: 'REQUEST_EXPIRED',
      });
    }
    return this.findOne(user, id);
  }

  // ----------------------------------------------------------------- helpers
  private parseWindow(startIso: string, endIso: string, now: Date) {
    const startAt = new Date(startIso);
    const endAt = new Date(endIso);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('startAt/endAt bukan tanggal yang valid');
    }
    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException('endAt harus setelah startAt');
    }
    // Acuan waktu = server, bukan client.
    if (startAt.getTime() < now.getTime() - START_TOLERANCE_MS) {
      throw new BadRequestException('startAt tidak boleh di masa lalu');
    }
    return { startAt, endAt };
  }

  private generateCode(now: Date): string {
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    let suffix = '';
    for (let i = 0; i < 8; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return `BR-${date}-${suffix}`;
  }

  /** Tabrakan request_code (sangat jarang) -> ulangi seluruh transaksi dengan kode baru. */
  private async withCodeRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const detail = (error as { driverError?: { detail?: string } }).driverError?.detail ?? '';
        if (attempt < 3 && getPgErrorCode(error) === '23505' && detail.includes('(request_code)')) continue;
        throw error;
      }
    }
  }
}
