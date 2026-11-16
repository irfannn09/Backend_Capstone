import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Trim } from '../../common/decorators/trim.decorator';
import { SearchQueryDto } from '../../common/dto/search-query.dto';
import { ItemClass } from '../../common/enums';

export class CreateItemTypeDto {
  @IsUUID('all', { message: 'Kategori barang harus berupa UUID yang valid' })
  categoryId: string;

  @Trim()
  @IsString({ message: 'Nama tipe barang harus berupa teks' })
  @IsNotEmpty({ message: 'Nama tipe barang tidak boleh kosong' })
  @MaxLength(150, { message: 'Nama tipe barang maksimal 150 karakter' })
  name: string;

  @IsEnum(ItemClass, {
    message: 'Jenis barang harus salah satu dari: PER_UNIT, CONSUMABLE',
  })
  itemClass: ItemClass;

  @Trim()
  @IsString({ message: 'Satuan harus berupa teks' })
  @IsNotEmpty({ message: 'Satuan tidak boleh kosong' })
  @MaxLength(50, { message: 'Satuan maksimal 50 karakter' })
  unitName: string;

  @IsOptional()
  @Trim()
  @IsString({ message: 'Deskripsi tipe barang harus berupa teks' })
  description?: string;
}

export class UpdateItemTypeDto extends PartialType(CreateItemTypeDto) {}

export class ListItemTypesQueryDto extends SearchQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'Kategori barang harus berupa UUID yang valid' })
  categoryId?: string;

  @IsOptional()
  @IsEnum(ItemClass, {
    message: 'Jenis barang harus salah satu dari: PER_UNIT, CONSUMABLE',
  })
  itemClass?: ItemClass;
}
