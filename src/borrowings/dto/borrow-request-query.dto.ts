import { IsEnum, IsOptional, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BorrowRequestStatus } from '../../common/enums';
import { ISO_MESSAGE, ISO_WITH_TIMEZONE } from './create-borrow-request.dto';

export class ListBorrowRequestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(BorrowRequestStatus, { message: 'Status peminjaman tidak valid' })
  status?: BorrowRequestStatus;
}

export class AvailabilityQueryDto {
  @IsOptional()
  @Matches(ISO_WITH_TIMEZONE, { message: `startAt ${ISO_MESSAGE}` })
  startAt?: string;

  @IsOptional()
  @Matches(ISO_WITH_TIMEZONE, { message: `endAt ${ISO_MESSAGE}` })
  endAt?: string;
}
