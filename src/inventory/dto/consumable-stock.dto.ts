import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { SearchQueryDto } from '../../common/dto/search-query.dto';

export class CreateConsumableStockDto {
  @IsUUID('all', { message: 'Tipe barang harus berupa UUID yang valid' })
  itemTypeId: string;

  /** Stok awal. Tidak boleh negatif. */
  @IsInt({ message: 'Stok saat ini harus berupa bilangan bulat' })
  @Min(0, { message: 'Stok saat ini tidak boleh kurang dari 0' })
  currentStock: number;

  @IsInt({ message: 'Stok minimum harus berupa bilangan bulat' })
  @Min(0, { message: 'Stok minimum tidak boleh kurang dari 0' })
  minimumStock: number;
}

/**
 * current_stock SENGAJA tidak dapat diubah di sini: perubahan stok harus lewat
 * stock_movements (Sprint 9) agar tercatat.
 */
export class UpdateConsumableStockDto {
  @IsInt({ message: 'Stok minimum harus berupa bilangan bulat' })
  @Min(0, { message: 'Stok minimum tidak boleh kurang dari 0' })
  minimumStock: number;
}

export class ListConsumableStocksQueryDto extends SearchQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'Tipe barang harus berupa UUID yang valid' })
  itemTypeId?: string;

  /** true = hanya stok yang <= minimum_stock */
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean({ message: 'Filter stok menipis harus berupa boolean' })
  lowStock?: boolean;
}
