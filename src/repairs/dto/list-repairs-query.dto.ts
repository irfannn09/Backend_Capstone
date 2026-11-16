import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RepairStatus } from '../../common/enums';

/** Filter discovery repair record (mis. hasil return PERLU_DIPERBAIKI). */
export class ListRepairsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'Unit inventaris harus berupa UUID yang valid' })
  inventoryUnitId?: string;

  @IsOptional()
  @IsEnum(RepairStatus, { message: 'Status perbaikan tidak valid' })
  repairStatus?: RepairStatus;
}
