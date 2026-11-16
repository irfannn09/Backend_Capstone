import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paginated, toPaginated } from '../common/dto/pagination-query.dto';
import { SearchQueryDto } from '../common/dto/search-query.dto';
import { isForeignKeyViolation } from '../common/utils/pg-error.util';
import { escapeLike } from '../common/utils/sql.util';
import { CreateItemCategoryDto, UpdateItemCategoryDto } from './dto/item-category.dto';
import { ItemCategory } from './entities/item-category.entity';

@Injectable()
export class ItemCategoriesService {
  constructor(
    @InjectRepository(ItemCategory) private readonly repo: Repository<ItemCategory>,
  ) {}

  async create(dto: CreateItemCategoryDto): Promise<ItemCategory> {
    await this.assertNameFree(dto.name);
    return this.repo.save(this.repo.create(dto));
  }

  async findAll(query: SearchQueryDto): Promise<Paginated<ItemCategory>> {
    const qb = this.repo.createQueryBuilder('c');
    if (query.search) {
      qb.where('c.name ILIKE :s', { s: `%${escapeLike(query.search)}%` });
    }
    qb.orderBy('c.name', 'ASC').skip((query.page - 1) * query.limit).take(query.limit);
    const [data, total] = await qb.getManyAndCount();
    return toPaginated(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<ItemCategory> {
    const category = await this.repo.findOne({ where: { id } });
    if (!category) throw new NotFoundException('Kategori tidak ditemukan');
    return category;
  }

  async update(id: string, dto: UpdateItemCategoryDto): Promise<ItemCategory> {
    const category = await this.findOne(id);
    if (dto.name !== undefined) await this.assertNameFree(dto.name, id);
    Object.assign(category, dto);
    return this.repo.save(category);
  }

  async remove(id: string): Promise<void> {
    const category = await this.findOne(id);
    try {
      await this.repo.remove(category);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Kategori masih digunakan oleh tipe barang dan tidak dapat dihapus',
        );
      }
      throw error;
    }
  }

  private async assertNameFree(name: string, excludeId?: string): Promise<void> {
    const qb = this.repo.createQueryBuilder('c').where('LOWER(c.name) = LOWER(:name)', { name });
    if (excludeId) qb.andWhere('c.id <> :id', { id: excludeId });
    if (await qb.getExists()) {
      throw new ConflictException('Nama kategori sudah digunakan');
    }
  }
}
