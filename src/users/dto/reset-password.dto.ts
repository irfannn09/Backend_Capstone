import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString({ message: 'Password baru harus berupa teks' })
  @MinLength(8, { message: 'Password baru minimal 8 karakter' })
  @MaxLength(72, { message: 'Password baru maksimal 72 karakter' })
  newPassword: string;
}
