import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Trim, TrimLowerCase } from '../../common/decorators/trim.decorator';

/** Role, password, dan is_active TIDAK bisa diubah lewat endpoint ini. */
export class UpdateUserDto {
  @IsOptional()
  @Trim()
  @IsString({ message: 'Nama lengkap harus berupa teks' })
  @IsNotEmpty({ message: 'Nama lengkap tidak boleh kosong' })
  @MaxLength(150, { message: 'Nama lengkap maksimal 150 karakter' })
  name?: string;

  /** null = hapus email (hanya SISWA/GURU). */
  @IsOptional()
  @TrimLowerCase()
  @IsEmail({}, { message: 'Email harus berupa alamat email yang valid' })
  @MaxLength(255, { message: 'Email maksimal 255 karakter' })
  email?: string | null;

  @IsOptional()
  @Trim()
  @IsString({ message: 'NIS harus berupa teks' })
  @IsNotEmpty({ message: 'NIS tidak boleh kosong' })
  @MaxLength(50, { message: 'NIS maksimal 50 karakter' })
  nis?: string;

  @IsOptional()
  @Trim()
  @IsString({ message: 'Kelas harus berupa teks' })
  @IsNotEmpty({ message: 'Kelas tidak boleh kosong' })
  @MaxLength(50, { message: 'Kelas maksimal 50 karakter' })
  className?: string;

  @IsOptional()
  @Trim()
  @IsString({ message: 'NIK harus berupa teks' })
  @IsNotEmpty({ message: 'NIK tidak boleh kosong' })
  @MaxLength(50, { message: 'NIK maksimal 50 karakter' })
  nik?: string;

  @IsOptional()
  @Trim()
  @IsString({ message: 'Mata pelajaran harus berupa teks' })
  @IsNotEmpty({ message: 'Mata pelajaran tidak boleh kosong' })
  @MaxLength(100, { message: 'Mata pelajaran maksimal 100 karakter' })
  subject?: string;
}
