import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Trim } from '../../common/decorators/trim.decorator';

export class CreateItemCategoryDto {
  @Trim()
  @IsString({ message: 'Nama kategori harus berupa teks' })
  @IsNotEmpty({ message: 'Nama kategori tidak boleh kosong' })
  @MaxLength(150, { message: 'Nama kategori maksimal 150 karakter' })
  name: string;

  @IsOptional()
  @Trim()
  @IsString({ message: 'Deskripsi kategori harus berupa teks' })
  description?: string;
}

export class UpdateItemCategoryDto extends PartialType(CreateItemCategoryDto) {}
