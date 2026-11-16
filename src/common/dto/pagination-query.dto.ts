import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Halaman harus berupa bilangan bulat' })
  @Min(1, { message: 'Halaman minimal 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Jumlah data per halaman harus berupa bilangan bulat' })
  @Min(1, { message: 'Jumlah data per halaman minimal 1' })
  @Max(100, { message: 'Jumlah data per halaman maksimal 100' })
  limit: number = 20;
}

export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export function toPaginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> {
  return {
    data,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}
