import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

export class SearchQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'Kata kunci pencarian harus berupa teks' })
  @MaxLength(100, { message: 'Kata kunci pencarian maksimal 100 karakter' })
  search?: string;
}
