import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';

export class LoginDto {
  /** SISWA: NIS, GURU: NIK, SAPRAS/ADMIN: email */
  @Trim()
  @IsString({ message: 'Identitas login harus berupa teks' })
  @IsNotEmpty({ message: 'Identitas login tidak boleh kosong' })
  @MaxLength(255, { message: 'Identitas login maksimal 255 karakter' })
  identifier: string;

  @IsString({ message: 'Password harus berupa teks' })
  @IsNotEmpty({ message: 'Password tidak boleh kosong' })
  @MaxLength(128, { message: 'Password maksimal 128 karakter' })
  password: string;
}
