import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { ItemCondition } from '../../common/enums';

/** Satu barang per unit yang dikembalikan, beserta hasil inspeksinya. */
export class ReturnItemDto {
  @IsNotEmpty({ message: 'ID item handover tidak boleh kosong' })
  @IsUUID('all', {
    message: 'ID item handover harus berupa UUID yang valid',
  })
  handoverItemId: string;

  @IsNotEmpty({ message: 'Kondisi barang tidak boleh kosong' })
  @IsEnum(ItemCondition, {
    message:
      'Kondisi barang harus salah satu dari: LAYAK_PAKAI, PERLU_DIPERBAIKI, RUSAK_TOTAL',
  })
  returnCondition: ItemCondition;

  @IsOptional()
  @Trim()
  @IsString({ message: 'Catatan kondisi harus berupa teks' })
  @MaxLength(500, { message: 'Catatan kondisi maksimal 500 karakter' })
  notes?: string | null;
}

/**
 * Return dilakukan sekali per request dan harus mencakup SEMUA barang
 * per unit dari handover request tersebut (return_records UNIQUE request_id).
 * Barang consumable tidak dikembalikan.
 */
export class CreateReturnDto {
  @IsNotEmpty({ message: 'ID peminjaman tidak boleh kosong' })
  @IsUUID('all', { message: 'ID peminjaman harus berupa UUID yang valid' })
  requestId: string;

  @IsArray({ message: 'Daftar barang yang dikembalikan harus berupa array' })
  @ArrayMinSize(1, {
    message: 'Daftar barang yang dikembalikan minimal 1 item',
  })
  @ArrayMaxSize(100, {
    message: 'Daftar barang yang dikembalikan maksimal 100 item',
  })
  @ValidateNested({
    each: true,
    message: 'Setiap barang yang dikembalikan harus valid',
  })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  @IsOptional()
  @Trim()
  @IsString({ message: 'Catatan return harus berupa teks' })
  @MaxLength(1000, { message: 'Catatan return maksimal 1000 karakter' })
  notes?: string | null;
}
