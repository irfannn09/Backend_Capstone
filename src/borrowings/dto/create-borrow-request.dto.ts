import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';

/** ISO-8601 lengkap dengan zona waktu, mis. 2026-11-10T08:00:00+07:00 atau ...Z */
export const ISO_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export const ISO_MESSAGE =
  'harus berformat ISO-8601 lengkap dengan zona waktu, mis. 2026-11-10T08:00:00+07:00';

/** Satu baris keranjang. User memilih tipe barang + jumlah; TIDAK memilih unit fisik. */
export class BorrowItemDto {
  @IsUUID('all', { message: 'Tipe barang harus berupa UUID yang valid' })
  itemTypeId: string;

  @IsInt({ message: 'Jumlah harus berupa bilangan bulat' })
  @Min(1, { message: 'Jumlah minimal 1' })
  @Max(1000, { message: 'Jumlah maksimal 1000' })
  quantity: number;

  @IsOptional()
  @Trim()
  @IsString({ message: 'Catatan barang harus berupa teks' })
  @MaxLength(500, { message: 'Catatan barang maksimal 500 karakter' })
  notes?: string;
}

export class CreateBorrowRequestDto {
  @IsArray({ message: 'Daftar barang harus berupa array' })
  @ArrayMinSize(1, { message: 'Daftar barang minimal 1 item' })
  @ArrayMaxSize(20, { message: 'Daftar barang maksimal 20 item' })
  @ValidateNested({
    each: true,
    message: 'Setiap barang pada daftar harus valid',
  })
  @Type(() => BorrowItemDto)
  items: BorrowItemDto[];

  @Matches(ISO_WITH_TIMEZONE, { message: `startAt ${ISO_MESSAGE}` })
  startAt: string;

  @Matches(ISO_WITH_TIMEZONE, { message: `endAt ${ISO_MESSAGE}` })
  endAt: string;

  @Trim()
  @IsString({ message: 'Tujuan peminjaman harus berupa teks' })
  @IsNotEmpty({ message: 'Tujuan peminjaman tidak boleh kosong' })
  @MaxLength(1000, { message: 'Tujuan peminjaman maksimal 1000 karakter' })
  purpose: string;

  /** Foto wajah (base64) untuk verifikasi. Diteruskan ke service face; tidak disimpan. */
  @IsString({ message: 'Foto wajah harus berupa teks base64' })
  @IsNotEmpty({ message: 'Foto wajah tidak boleh kosong' })
  @MaxLength(5_000_000, {
    message: 'Foto wajah terlalu besar (maksimal 5.000.000 karakter)',
  })
  faceImage: string;
}
