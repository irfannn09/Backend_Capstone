import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Trim } from '../../common/decorators/trim.decorator';

export class CreateLocationDto {
  @Trim()
  @IsString({ message: 'Nama lokasi harus berupa teks' })
  @IsNotEmpty({ message: 'Nama lokasi tidak boleh kosong' })
  @MaxLength(150, { message: 'Nama lokasi maksimal 150 karakter' })
  name: string;

  @IsOptional()
  @Trim()
  @IsString({ message: 'Deskripsi lokasi harus berupa teks' })
  description?: string;
}

export class UpdateLocationDto extends PartialType(CreateLocationDto) {}
