import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paginated, toPaginated } from '../common/dto/pagination-query.dto';
import { SearchQueryDto } from '../common/dto/search-query.dto';
import { isForeignKeyViolation } from '../common/utils/pg-error.util';
import { escapeLike } from '../common/utils/sql.util';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';
import { Location } from './entities/location.entity';

@Injectable()
export class LocationsService {
  constructor(@InjectRepository(Location) private readonly repo: Repository<Location>) {}

  async create(dto: CreateLocationDto): Promise<Location> {
    await this.assertNameFree(dto.name);
    return this.repo.save(this.repo.create(dto));
  }

  async findAll(query: SearchQueryDto): Promise<Paginated<Location>> {
    const qb = this.repo.createQueryBuilder('l');
    if (query.search) {
      qb.where('l.name ILIKE :s', { s: `%${escapeLike(query.search)}%` });
    }
    qb.orderBy('l.name', 'ASC').skip((query.page - 1) * query.limit).take(query.limit);
    const [data, total] = await qb.getManyAndCount();
    return toPaginated(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<Location> {
    const location = await this.repo.findOne({ where: { id } });
    if (!location) throw new NotFoundException('Lokasi tidak ditemukan');
    return location;
  }

  async update(id: string, dto: UpdateLocationDto): Promise<Location> {
    const location = await this.findOne(id);
    if (dto.name !== undefined) await this.assertNameFree(dto.name, id);
    Object.assign(location, dto);
    return this.repo.save(location);
  }

  async remove(id: string): Promise<void> {
    const location = await this.findOne(id);
    try {
      await this.repo.remove(location);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Lokasi masih digunakan oleh unit inventaris dan tidak dapat dihapus',
        );
      }
      throw error;
    }
  }

  private async assertNameFree(name: string, excludeId?: string): Promise<void> {
    const qb = this.repo.createQueryBuilder('l').where('LOWER(l.name) = LOWER(:name)', { name });
    if (excludeId) qb.andWhere('l.id <> :id', { id: excludeId });
    if (await qb.getExists()) throw new ConflictException('Nama lokasi sudah digunakan');
  }
}
