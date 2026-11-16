import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Paginated, toPaginated } from '../common/dto/pagination-query.dto';
import {
  AvailabilityStatus,
  ItemCondition,
  RepairStatus,
} from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';
import { ListRepairsQueryDto } from './dto/list-repairs-query.dto';
import { RepairActionDto } from './dto/repair-action.dto';
import { RepairResponseDto } from './dto/repair-response.dto';
import { RepairRecord } from './entities/repair-record.entity';

/**
 * Workflow perbaikan barang per unit.
 *
 * Transisi yang diizinkan (tidak ada reopen/rework):
 *   MENUNGGU_PERBAIKAN -> SEDANG_DIPERBAIKI
 *   SEDANG_DIPERBAIKI  -> SELESAI_DIPERBAIKI
 *   SEDANG_DIPERBAIKI  -> TIDAK_DAPAT_DIPERBAIKI
 *
 * Status repair dan kondisi unit fisik diubah dalam satu transaksi.
 * Status akhir ditentukan oleh endpoint aksi, bukan dari body request.
 * `handledBy` selalu berasal dari user JWT.
 */
@Injectable()
export class RepairsService {
  private readonly logger = new Logger(RepairsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** MENUNGGU_PERBAIKAN -> SEDANG_DIPERBAIKI. */
  async start(
    actor: AuthenticatedUser,
    id: string,
    dto?: RepairActionDto,
  ): Promise<RepairResponseDto> {
    return this.transition(
      actor,
      id,
      RepairStatus.MENUNGGU_PERBAIKAN,
      RepairStatus.SEDANG_DIPERBAIKI,
      dto,
    );
  }

  /** SEDANG_DIPERBAIKI -> SELESAI_DIPERBAIKI. */
  async complete(
    actor: AuthenticatedUser,
    id: string,
    dto?: RepairActionDto,
  ): Promise<RepairResponseDto> {
    return this.transition(
      actor,
      id,
      RepairStatus.SEDANG_DIPERBAIKI,
      RepairStatus.SELESAI_DIPERBAIKI,
      dto,
    );
  }

  /** SEDANG_DIPERBAIKI -> TIDAK_DAPAT_DIPERBAIKI. */
  async markUnrepairable(
    actor: AuthenticatedUser,
    id: string,
    dto?: RepairActionDto,
  ): Promise<RepairResponseDto> {
    return this.transition(
      actor,
      id,
      RepairStatus.SEDANG_DIPERBAIKI,
      RepairStatus.TIDAK_DAPAT_DIPERBAIKI,
      dto,
    );
  }

  async findOne(id: string): Promise<RepairResponseDto> {
    const record = await this.dataSource.manager.findOne(RepairRecord, {
      where: { id },
      relations: { inventoryUnit: true },
    });
    if (!record) {
      throw new NotFoundException('Data perbaikan tidak ditemukan');
    }
    return RepairResponseDto.from(record);
  }

  /**
   * Discovery repair record (mis. yang baru dibuat dari return PERLU_DIPERBAIKI)
   * tanpa perlu mengakses database langsung.
   */
  async findAll(query: ListRepairsQueryDto): Promise<Paginated<RepairResponseDto>> {
    const qb = this.dataSource.manager
      .createQueryBuilder(RepairRecord, 'r')
      .leftJoinAndSelect('r.inventoryUnit', 'u');

    if (query.inventoryUnitId) {
      qb.andWhere('r.inventoryUnitId = :inventoryUnitId', {
        inventoryUnitId: query.inventoryUnitId,
      });
    }
    if (query.repairStatus) {
      qb.andWhere('r.repairStatus = :repairStatus', {
        repairStatus: query.repairStatus,
      });
    }
    qb.orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [data, total] = await qb.getManyAndCount();
    return toPaginated(
      data.map((record) => RepairResponseDto.from(record)),
      total,
      query.page,
      query.limit,
    );
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    expected: RepairStatus,
    next: RepairStatus,
    dto?: RepairActionDto,
  ): Promise<RepairResponseDto> {
    const repairId = await this.dataSource.transaction(async (manager) => {
      const record = await manager.findOne(RepairRecord, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) {
        throw new NotFoundException('Data perbaikan tidak ditemukan');
      }

      if (record.repairStatus !== expected) {
        throw new ConflictException({
          message: `Perbaikan berstatus ${record.repairStatus} tidak dapat diubah menjadi ${next}`,
          code: 'INVALID_REPAIR_TRANSITION',
          details: {
            currentStatus: record.repairStatus,
            requestedStatus: next,
          },
        });
      }

      const unit = await manager.findOne(InventoryUnit, {
        where: { id: record.inventoryUnitId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!unit) {
        throw new NotFoundException(
          `Unit inventaris ${record.inventoryUnitId} tidak ditemukan`,
        );
      }

      const target = this.unitStateFor(next);

      record.repairStatus = next;
      record.handledBy = actor.userId;
      if (dto?.repairNotes !== undefined) {
        record.repairNotes = dto.repairNotes ?? null;
      }
      if (
        next === RepairStatus.SELESAI_DIPERBAIKI ||
        next === RepairStatus.TIDAK_DAPAT_DIPERBAIKI
      ) {
        record.completedAt = new Date();
      }
      await manager.save(record);

      unit.currentCondition = target.currentCondition;
      unit.availabilityStatus = target.availabilityStatus;
      await manager.save(unit);

      return record.id;
    });

    this.logger.log(
      `Repair ${id} diubah ke ${next} oleh sapras ${actor.userId}`,
    );
    return this.findOne(repairId);
  }

  private unitStateFor(status: RepairStatus): {
    currentCondition: ItemCondition;
    availabilityStatus: AvailabilityStatus;
  } {
    switch (status) {
      case RepairStatus.SEDANG_DIPERBAIKI:
        return {
          currentCondition: ItemCondition.PERLU_DIPERBAIKI,
          availabilityStatus: AvailabilityStatus.REPAIR,
        };
      case RepairStatus.SELESAI_DIPERBAIKI:
        return {
          currentCondition: ItemCondition.LAYAK_PAKAI,
          availabilityStatus: AvailabilityStatus.AVAILABLE,
        };
      case RepairStatus.TIDAK_DAPAT_DIPERBAIKI:
        return {
          currentCondition: ItemCondition.RUSAK_TOTAL,
          availabilityStatus: AvailabilityStatus.UNAVAILABLE,
        };
      case RepairStatus.MENUNGGU_PERBAIKAN:
        return {
          currentCondition: ItemCondition.PERLU_DIPERBAIKI,
          availabilityStatus: AvailabilityStatus.REPAIR,
        };
    }
  }
}
