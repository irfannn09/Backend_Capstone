import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';

/**
 * Body untuk aksi workflow perbaikan.
 *
 * Status akhir TIDAK diterima dari body: transisi ditentukan oleh endpoint
 * (start/complete/unrepairable). `handledBy` juga berasal dari JWT.
 */
export class RepairActionDto {
  @IsOptional()
  @Trim()
  @IsString({ message: 'Catatan perbaikan harus berupa teks' })
  @MaxLength(1000, { message: 'Catatan perbaikan maksimal 1000 karakter' })
  repairNotes?: string | null;
}
