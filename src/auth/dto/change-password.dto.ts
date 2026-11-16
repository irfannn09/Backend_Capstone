import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString({ message: 'Password saat ini harus berupa teks' })
  @IsNotEmpty({ message: 'Password saat ini tidak boleh kosong' })
  @MaxLength(128, { message: 'Password saat ini maksimal 128 karakter' })
  currentPassword: string;

  @IsString({ message: 'Password baru harus berupa teks' })
  @MinLength(8, { message: 'Password baru minimal 8 karakter' })
  @MaxLength(72, { message: 'Password baru maksimal 72 karakter' })
  newPassword: string;
}
