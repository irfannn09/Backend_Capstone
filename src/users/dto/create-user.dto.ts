import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../common/enums';
import { Trim, TrimLowerCase } from '../../common/decorators/trim.decorator';

/** Role yang boleh dibuat lewat API. ADMIN dibuat lewat seed (npm run seed:admin). */
export const CREATABLE_ROLES = [
  UserRole.SISWA,
  UserRole.GURU,
  UserRole.SAPRAS,
] as const;

export class CreateUserDto {
  @IsIn(CREATABLE_ROLES, {
    message: 'Role harus salah satu dari: SISWA, GURU, SAPRAS',
  })
  role: UserRole;

  @Trim()
  @IsString({ message: 'Nama lengkap harus berupa teks' })
  @IsNotEmpty({ message: 'Nama lengkap tidak boleh kosong' })
  @MaxLength(150, { message: 'Nama lengkap maksimal 150 karakter' })
  name: string;

  /** Wajib untuk SAPRAS; opsional untuk SISWA/GURU. */
  @IsOptional()
  @TrimLowerCase()
  @IsEmail({}, { message: 'Email harus berupa alamat email yang valid' })
  @MaxLength(255, { message: 'Email maksimal 255 karakter' })
  email?: string;

  /** Password awal. Selalu menghasilkan must_change_password = true. */
  @IsString({ message: 'Password harus berupa teks' })
  @MinLength(8, { message: 'Password minimal 8 karakter' })
  @MaxLength(72, { message: 'Password maksimal 72 karakter' })
  password: string;

  // --- Profile SISWA ---
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

  // --- Profile GURU ---
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
