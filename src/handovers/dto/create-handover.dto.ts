import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Trim } from '../../common/decorators/trim.decorator';

/** Unit fisik dipilih SAPRAS saat handover, bukan saat approval. */
export class HandoverItemSelectionDto {
  @IsNotEmpty({ message: 'ID item permintaan tidak boleh kosong' })
  @IsUUID('all', { message: 'ID item permintaan harus berupa UUID yang valid' })
  requestItemId: string;

  @IsArray({ message: 'Daftar unit inventaris harus berupa array' })
  @ArrayMinSize(1, { message: 'Minimal pilih 1 unit inventaris' })
  @ArrayMaxSize(1000, { message: 'Maksimal 1000 unit inventaris' })
  @ArrayUnique({ message: 'Unit inventaris tidak boleh dipilih dua kali' })
  @IsUUID('all', {
    each: true,
    message: 'Setiap ID unit inventaris harus berupa UUID yang valid',
  })
  inventoryUnitIds: string[];
}

export class CreateHandoverDto {
  @IsNotEmpty({ message: 'ID peminjaman tidak boleh kosong' })
  @IsUUID('all', { message: 'ID peminjaman harus berupa UUID yang valid' })
  requestId: string;

  /** Wajib untuk PER_UNIT; CONSUMABLE tidak perlu dipilih unit fisiknya. */
  @IsArray({ message: 'Daftar pilihan unit harus berupa array' })
  @ValidateNested({ each: true, message: 'Setiap pilihan unit harus valid' })
  @Type(() => HandoverItemSelectionDto)
  @IsOptional()
  selections?: HandoverItemSelectionDto[];

  @IsOptional()
  @Trim()
  @IsString({ message: 'Catatan handover harus berupa teks' })
  @MaxLength(1000, {
    message: 'Catatan handover maksimal 1000 karakter',
  })
  notes?: string | null;
}
