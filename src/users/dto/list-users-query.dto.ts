import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UserRole } from '../../common/enums';

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserRole, {
    message: 'Role harus salah satu dari: ADMIN, SAPRAS, SISWA, GURU',
  })
  role?: UserRole;

  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean({ message: 'Status aktif harus berupa boolean' })
  isActive?: boolean;

  @IsOptional()
  @IsString({ message: 'Kata kunci pencarian harus berupa teks' })
  @MaxLength(100, { message: 'Kata kunci pencarian maksimal 100 karakter' })
  search?: string;
}
