import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { Trim } from '../../common/decorators/trim.decorator';
import { SearchQueryDto } from '../../common/dto/search-query.dto';
import { AvailabilityStatus, ItemCondition } from '../../common/enums';

/**
 * BOOKED & BORROWED dikelola proses booking/handover (Sprint 8-9),
 * sehingga tidak boleh diset manual lewat API inventaris.
 */
export const MANUAL_AVAILABILITY = [
  AvailabilityStatus.AVAILABLE,
  AvailabilityStatus.REPAIR,
  AvailabilityStatus.UNAVAILABLE,
] as const;

export class CreateInventoryUnitDto {
  @IsUUID('all', { message: 'Tipe barang harus berupa UUID yang valid' })
  itemTypeId: string;

  @IsUUID('all', { message: 'Lokasi harus berupa UUID yang valid' })
  locationId: string;

  @Trim()
  @IsString({ message: 'Kode inventaris harus berupa teks' })
  @IsNotEmpty({ message: 'Kode inventaris tidak boleh kosong' })
  @MaxLength(100, { message: 'Kode inventaris maksimal 100 karakter' })
  inventoryCode: string;

  @IsOptional()
  @Trim()
  @IsString({ message: 'Nomor seri harus berupa teks' })
  @IsNotEmpty({ message: 'Nomor seri tidak boleh kosong' })
  @MaxLength(150, { message: 'Nomor seri maksimal 150 karakter' })
  serialNumber?: string | null;

  @Trim()
  @IsString({ message: 'Barcode harus berupa teks' })
  @IsNotEmpty({ message: 'Barcode tidak boleh kosong' })
  @MaxLength(150, { message: 'Barcode maksimal 150 karakter' })
  barcode: string;

  /** Default: LAYAK_PAKAI */
  @IsOptional()
  @IsEnum(ItemCondition, {
    message:
      'Kondisi barang harus salah satu dari: LAYAK_PAKAI, PERLU_DIPERBAIKI, RUSAK_TOTAL',
  })
  currentCondition?: ItemCondition;

  /** Default: AVAILABLE */
  @IsOptional()
  @IsIn(MANUAL_AVAILABILITY, {
    message:
      'Status ketersediaan hanya boleh AVAILABLE, REPAIR, atau UNAVAILABLE',
  })
  availabilityStatus?: AvailabilityStatus;

  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'Tanggal pembelian harus berupa tanggal yang valid' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Tanggal pembelian harus berformat YYYY-MM-DD',
  })
  purchaseDate?: string | null;

  @IsOptional()
  @Trim()
  @IsString({ message: 'Catatan harus berupa teks' })
  notes?: string | null;
}

/** item_type tidak boleh dipindah setelah unit dibuat. */
export class UpdateInventoryUnitDto extends PartialType(
  OmitType(CreateInventoryUnitDto, ['itemTypeId'] as const),
) {}

export class ListInventoryUnitsQueryDto extends SearchQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'Tipe barang harus berupa UUID yang valid' })
  itemTypeId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Lokasi harus berupa UUID yang valid' })
  locationId?: string;

  @IsOptional()
  @IsEnum(AvailabilityStatus, {
    message: 'Status ketersediaan tidak valid',
  })
  availabilityStatus?: AvailabilityStatus;

  @IsOptional()
  @IsEnum(ItemCondition, {
    message:
      'Kondisi barang harus salah satu dari: LAYAK_PAKAI, PERLU_DIPERBAIKI, RUSAK_TOTAL',
  })
  currentCondition?: ItemCondition;
}
