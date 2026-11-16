import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Paginated, toPaginated } from '../common/dto/pagination-query.dto';
import { ItemClass, StockMovementType } from '../common/enums';
import { escapeLike } from '../common/utils/sql.util';
import { ItemType } from '../master-data/entities/item-type.entity';
import { StockMovement } from '../stock/entities/stock-movement.entity';
import {
  CreateConsumableStockDto,
  ListConsumableStocksQueryDto,
  UpdateConsumableStockDto,
} from './dto/consumable-stock.dto';
import { ConsumableStock } from './entities/consumable-stock.entity';

@Injectable()
export class ConsumableStocksService {
  constructor(
    @InjectRepository(ConsumableStock) private readonly repo: Repository<ConsumableStock>,
    @InjectRepository(ItemType) private readonly itemTypes: Repository<ItemType>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * currentStock saat pembuatan pertama = stok masuk awal, dicatat sebagai STOCK_IN.
   * ConsumableStock + StockMovement dibuat dalam satu transaksi agar tidak setengah jadi.
   * `createdBy` berasal dari user yang login (controller), bukan body request.
   */
  async create(userId: string, dto: CreateConsumableStockDto): Promise<ConsumableStock> {
    const itemType = await this.itemTypes.findOne({ where: { id: dto.itemTypeId } });
    if (!itemType) throw new NotFoundException('Tipe barang tidak ditemukan');

    if (itemType.itemClass !== ItemClass.CONSUMABLE) {
      throw new ConflictException(
        'Stok hanya dapat dibuat untuk tipe barang CONSUMABLE. Barang PER_UNIT menggunakan unit inventaris.',
      );
    }
    if (await this.repo.exists({ where: { itemTypeId: dto.itemTypeId } })) {
      throw new ConflictException('Stok untuk tipe barang ini sudah ada');
    }

    const stockId = await this.dataSource.transaction(async (manager) => {
      const stock = await manager.save(
        manager.create(ConsumableStock, {
          itemTypeId: dto.itemTypeId,
          currentStock: dto.currentStock,
          minimumStock: dto.minimumStock,
        }),
      );
      await manager.save(
        manager.create(StockMovement, {
          consumableStockId: stock.id,
          type: StockMovementType.STOCK_IN,
          quantity: dto.currentStock, // selalu non-negatif, sama dengan stok awal
          referenceId: null, // tidak ada dokumen referensi untuk stok awal
          notes: 'Stok awal',
          createdBy: userId,
        }),
      );
      return stock.id;
    });

    return this.findOne(stockId);
  }

  async findAll(query: ListConsumableStocksQueryDto): Promise<Paginated<ConsumableStock>> {
    const qb = this.repo.createQueryBuilder('s').leftJoinAndSelect('s.itemType', 't');
    if (query.itemTypeId) qb.andWhere('s.itemTypeId = :tid', { tid: query.itemTypeId });
    if (query.lowStock) qb.andWhere('s.currentStock <= s.minimumStock');
    if (query.search) {
      qb.andWhere('t.name ILIKE :q', { q: `%${escapeLike(query.search)}%` });
    }
    qb.orderBy('t.name', 'ASC').skip((query.page - 1) * query.limit).take(query.limit);
    const [data, total] = await qb.getManyAndCount();
    return toPaginated(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<ConsumableStock> {
    const stock = await this.repo.findOne({ where: { id }, relations: { itemType: true } });
    if (!stock) throw new NotFoundException('Stok tidak ditemukan');
    return stock;
  }

  async update(id: string, dto: UpdateConsumableStockDto): Promise<ConsumableStock> {
    await this.dataSource.transaction(async (manager) => {
      // Kunci baris agar STOCK_OUT/handover bersamaan tidak tertimpa snapshot lama.
      const stock = await manager.findOne(ConsumableStock, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!stock) throw new NotFoundException('Stok tidak ditemukan');

      // Hanya minimum_stock yang boleh diubah PATCH; current_stock tidak pernah
      // ditulis ulang dari snapshot (perubahan stok hanya lewat stock movement).
      await manager.update(ConsumableStock, { id }, { minimumStock: dto.minimumStock });
    });
    return this.findOne(id);
  }
}
