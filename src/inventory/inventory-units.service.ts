import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Paginated, toPaginated } from '../common/dto/pagination-query.dto';
import { AvailabilityStatus, ItemClass, ItemCondition } from '../common/enums';
import { escapeLike } from '../common/utils/sql.util';
import { ItemType } from '../master-data/entities/item-type.entity';
import { Location } from '../master-data/entities/location.entity';
import {
  CreateInventoryUnitDto,
  ListInventoryUnitsQueryDto,
  UpdateInventoryUnitDto,
} from './dto/inventory-unit.dto';
import { InventoryUnit } from './entities/inventory-unit.entity';

@Injectable()
export class InventoryUnitsService {
  constructor(
    @InjectRepository(InventoryUnit) private readonly repo: Repository<InventoryUnit>,
    @InjectRepository(ItemType) private readonly itemTypes: Repository<ItemType>,
    @InjectRepository(Location) private readonly locations: Repository<Location>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateInventoryUnitDto): Promise<InventoryUnit> {
    const itemType = await this.itemTypes.findOne({ where: { id: dto.itemTypeId } });
    if (!itemType) throw new NotFoundException('Tipe barang tidak ditemukan');

    // Unit fisik hanya untuk PER_UNIT; consumable memakai consumable_stocks.
    if (itemType.itemClass !== ItemClass.PER_UNIT) {
      throw new ConflictException(
        'Unit inventaris hanya dapat dibuat untuk tipe barang PER_UNIT. Barang CONSUMABLE menggunakan stok.',
      );
    }
    await this.assertLocationExists(dto.locationId);
    await this.assertUnique(dto.inventoryCode, dto.barcode);

    const saved = await this.repo.save(
      this.repo.create({
        itemTypeId: dto.itemTypeId,
        locationId: dto.locationId,
        inventoryCode: dto.inventoryCode,
        serialNumber: dto.serialNumber ?? null,
        barcode: dto.barcode,
        currentCondition: dto.currentCondition ?? ItemCondition.LAYAK_PAKAI,
        availabilityStatus: dto.availabilityStatus ?? AvailabilityStatus.AVAILABLE,
        purchaseDate: dto.purchaseDate ?? null,
        notes: dto.notes ?? null,
      }),
    );
    return this.findOne(saved.id);
  }

  async findAll(query: ListInventoryUnitsQueryDto): Promise<Paginated<InventoryUnit>> {
    const qb = this.repo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.itemType', 't')
      .leftJoinAndSelect('u.location', 'l');

    if (query.itemTypeId) qb.andWhere('u.itemTypeId = :tid', { tid: query.itemTypeId });
    if (query.locationId) qb.andWhere('u.locationId = :lid', { lid: query.locationId });
    if (query.availabilityStatus) {
      qb.andWhere('u.availabilityStatus = :av', { av: query.availabilityStatus });
    }
    if (query.currentCondition) {
      qb.andWhere('u.currentCondition = :cc', { cc: query.currentCondition });
    }
    if (query.search) {
      qb.andWhere(
        '(u.inventoryCode ILIKE :s OR u.barcode ILIKE :s OR u.serialNumber ILIKE :s)',
        { s: `%${escapeLike(query.search)}%` },
      );
    }
    qb.orderBy('u.inventoryCode', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [data, total] = await qb.getManyAndCount();
    return toPaginated(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<InventoryUnit> {
    const unit = await this.repo.findOne({
      where: { id },
      relations: { itemType: true, location: true },
    });
    if (!unit) throw new NotFoundException('Unit inventaris tidak ditemukan');
    return unit;
  }

  async update(id: string, dto: UpdateInventoryUnitDto): Promise<InventoryUnit> {
    await this.dataSource.transaction(async (manager) => {
      // Lock baris: handover/return/repair bisa mengubah row yang sama.
      const unit = await manager.findOne(InventoryUnit, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!unit) throw new NotFoundException('Unit inventaris tidak ditemukan');

      if (dto.locationId !== undefined && dto.locationId !== unit.locationId) {
        await this.assertLocationExists(dto.locationId);
      }
      if (dto.inventoryCode !== undefined || dto.barcode !== undefined) {
        await this.assertUnique(
          dto.inventoryCode !== unit.inventoryCode ? dto.inventoryCode : undefined,
          dto.barcode !== unit.barcode ? dto.barcode : undefined,
          id,
        );
      }
      // Unit yang sedang BOOKED/BORROWED dikunci oleh proses peminjaman.
      if (
        dto.availabilityStatus !== undefined &&
        dto.availabilityStatus !== unit.availabilityStatus &&
        [AvailabilityStatus.BOOKED, AvailabilityStatus.BORROWED].includes(unit.availabilityStatus)
      ) {
        throw new ConflictException(
          `Status unit ${unit.availabilityStatus} dikelola oleh proses peminjaman dan tidak dapat diubah manual`,
        );
      }

      // Hanya field yang dikirim DTO yang ditulis. Field lain (availability,
      // condition, dll.) tidak boleh dikembalikan ke snapshot lama.
      const patch: Partial<InventoryUnit> = {};
      if (dto.locationId !== undefined) patch.locationId = dto.locationId;
      if (dto.inventoryCode !== undefined) patch.inventoryCode = dto.inventoryCode;
      if (dto.serialNumber !== undefined) patch.serialNumber = dto.serialNumber;
      if (dto.barcode !== undefined) patch.barcode = dto.barcode;
      if (dto.currentCondition !== undefined) patch.currentCondition = dto.currentCondition;
      if (dto.availabilityStatus !== undefined) patch.availabilityStatus = dto.availabilityStatus;
      if (dto.purchaseDate !== undefined) patch.purchaseDate = dto.purchaseDate;
      if (dto.notes !== undefined) patch.notes = dto.notes;

      if (Object.keys(patch).length) {
        await manager.update(InventoryUnit, { id }, patch);
      }
    });
    return this.findOne(id);
  }

  private async assertLocationExists(locationId: string): Promise<void> {
    if (!(await this.locations.exists({ where: { id: locationId } }))) {
      throw new NotFoundException('Lokasi tidak ditemukan');
    }
  }

  private async assertUnique(code?: string, barcode?: string, excludeId?: string): Promise<void> {
    const conflicts: string[] = [];
    for (const [field, value, label] of [
      ['inventoryCode', code, 'Inventory code'],
      ['barcode', barcode, 'Barcode'],
    ] as const) {
      if (!value) continue;
      const qb = this.repo.createQueryBuilder('u').where(`u.${field} = :v`, { v: value });
      if (excludeId) qb.andWhere('u.id <> :id', { id: excludeId });
      if (await qb.getExists()) conflicts.push(`${label} sudah digunakan`);
    }
    if (conflicts.length) throw new ConflictException(conflicts);
  }
}
