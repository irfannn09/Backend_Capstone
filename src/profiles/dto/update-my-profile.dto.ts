import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';

/**
 * Self-service: hanya field yang tidak berfungsi sebagai identitas login.
 * NIS/NIK (identifier login) hanya dapat diubah Admin lewat PATCH /users/:id.
 */
export class UpdateMyProfileDto {
  @IsOptional()
  @Trim()
  @IsString({ message: 'Kelas harus berupa teks' })
  @IsNotEmpty({ message: 'Kelas tidak boleh kosong' })
  @MaxLength(50, { message: 'Kelas maksimal 50 karakter' })
  className?: string;

  @IsOptional()
  @Trim()
  @IsString({ message: 'Mata pelajaran harus berupa teks' })
  @IsNotEmpty({ message: 'Mata pelajaran tidak boleh kosong' })
  @MaxLength(100, { message: 'Mata pelajaran maksimal 100 karakter' })
  subject?: string;
}
