import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { BorrowApprovalService } from './borrow-approval.service';
import { BorrowRequestsService } from './borrow-requests.service';
import { ApproveBorrowRequestDto } from './dto/approve-borrow-request.dto';
import { ListBorrowRequestsQueryDto } from './dto/borrow-request-query.dto';
import { CreateBorrowRequestDto } from './dto/create-borrow-request.dto';

const BORROWERS = [UserRole.SISWA, UserRole.GURU];

@Controller('borrow-requests')
export class BorrowRequestsController {
  constructor(
    private readonly requests: BorrowRequestsService,
    private readonly approval: BorrowApprovalService,
  ) {}

  /** Satu keranjang = satu request. Wajib menyertakan foto wajah untuk verifikasi. */
  @Post()
  @Roles(...BORROWERS)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBorrowRequestDto) {
    return this.requests.create(user, dto);
  }

  /** Siswa/Guru: milik sendiri. Sapras: semua request. ADMIN tidak punya akses. */
  @Get()
  @Roles(...BORROWERS, UserRole.SAPRAS)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListBorrowRequestsQueryDto) {
    return this.requests.list(user, query);
  }

  // Harus dideklarasikan SEBELUM ':id'.
  @Get('pending')
  @Roles(UserRole.SAPRAS)
  pending(@Query() query: ListBorrowRequestsQueryDto) {
    return this.requests.listPending(query);
  }

  @Get(':id')
  @Roles(...BORROWERS, UserRole.SAPRAS)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.findOne(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(...BORROWERS)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.cancel(user, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles(UserRole.SAPRAS)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveBorrowRequestDto,
  ) {
    return this.approval.approve(user, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles(UserRole.SAPRAS)
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.approval.reject(user, id);
  }
}
