import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paginated, toPaginated } from '../common/dto/pagination-query.dto';
import { isForeignKeyViolation } from '../common/utils/pg-error.util';
import { escapeLike } from '../common/utils/sql.util';
import {
  CreateItemTypeDto,
  ListItemTypesQueryDto,
  UpdateItemTypeDto,
} from './dto/item-type.dto';
import { ItemCategory } from './entities/item-category.entity';
import { ItemType } from './entities/item-type.entity';
import { ConsumableStock } from '../inventory/entities/consumable-stock.entity';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';

@Injectable()
export class ItemTypesService {
  constructor(
    @InjectRepository(ItemType) private readonly repo: Repository<ItemType>,
    @InjectRepository(ItemCategory) private readonly categories: Repository<ItemCategory>,
    @InjectRepository(InventoryUnit) private readonly units: Repository<InventoryUnit>,
    @InjectRepository(ConsumableStock) private readonly stocks: Repository<ConsumableStock>,
  ) {}

  async create(dto: CreateItemTypeDto): Promise<ItemType> {
    await this.assertCategoryExists(dto.categoryId);
    await this.assertNameFree(dto.categoryId, dto.name);
    const saved = await this.repo.save(this.repo.create(dto));
    return this.findOne(saved.id);
  }

  async findAll(query: ListItemTypesQueryDto): Promise<Paginated<ItemType>> {
    const qb = this.repo.createQueryBuilder('t').leftJoinAndSelect('t.category', 'c');
    if (query.categoryId) qb.andWhere('t.categoryId = :cid', { cid: query.categoryId });
    if (query.itemClass) qb.andWhere('t.itemClass = :ic', { ic: query.itemClass });
    if (query.search) {
      qb.andWhere('t.name ILIKE :s', { s: `%${escapeLike(query.search)}%` });
    }
    qb.orderBy('t.name', 'ASC').skip((query.page - 1) * query.limit).take(query.limit);
    const [data, total] = await qb.getManyAndCount();
    return toPaginated(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<ItemType> {
    const type = await this.repo.findOne({ where: { id }, relations: { category: true } });
    if (!type) throw new NotFoundException('Tipe barang tidak ditemukan');
    return type;
  }

  async update(id: string, dto: UpdateItemTypeDto): Promise<ItemType> {
    const type = await this.findOne(id);

    if (dto.categoryId !== undefined && dto.categoryId !== type.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    // item_class menentukan apakah barang berupa unit fisik atau stok.
    // Setelah ada unit/stok, class tidak boleh berubah.
    if (dto.itemClass !== undefined && dto.itemClass !== type.itemClass) {
      const hasUnits = await this.units.exists({ where: { itemTypeId: id } });
      const hasStock = await this.stocks.exists({ where: { itemTypeId: id } });
      if (hasUnits || hasStock) {
        throw new ConflictException(
          'itemClass tidak dapat diubah karena tipe barang sudah memiliki unit inventaris atau stok',
        );
      }
    }

    const newCategoryId = dto.categoryId ?? type.categoryId;
    const newName = dto.name ?? type.name;
    if (newCategoryId !== type.categoryId || newName.toLowerCase() !== type.name.toLowerCase()) {
      await this.assertNameFree(newCategoryId, newName, id);
    }

    const { category: _ignored, ...rest } = type;
    await this.repo.save({ ...rest, ...dto });
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const type = await this.findOne(id);
    try {
      await this.repo.remove(type);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Tipe barang masih digunakan (unit, stok, atau peminjaman) dan tidak dapat dihapus',
        );
      }
      throw error;
    }
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    if (!(await this.categories.exists({ where: { id: categoryId } }))) {
      throw new NotFoundException('Kategori tidak ditemukan');
    }
  }

  private async assertNameFree(categoryId: string, name: string, excludeId?: string): Promise<void> {
    const qb = this.repo
      .createQueryBuilder('t')
      .where('t.categoryId = :categoryId', { categoryId })
      .andWhere('LOWER(t.name) = LOWER(:name)', { name });
    if (excludeId) qb.andWhere('t.id <> :id', { id: excludeId });
    if (await qb.getExists()) {
      throw new ConflictException('Tipe barang dengan nama tersebut sudah ada pada kategori ini');
    }
  }
}
