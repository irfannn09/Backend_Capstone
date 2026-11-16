import { IsBoolean } from 'class-validator';

export class UpdateUserStatusDto {
  @IsBoolean({ message: 'Status aktif harus berupa boolean' })
  isActive: boolean;
}
