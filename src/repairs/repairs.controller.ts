import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ListRepairsQueryDto } from './dto/list-repairs-query.dto';
import { RepairActionDto } from './dto/repair-action.dto';
import { RepairsService } from './repairs.service';

@Controller('repairs')
@Roles(UserRole.SAPRAS, UserRole.ADMIN)
export class RepairsController {
  constructor(private readonly repairs: RepairsService) {}

  /** Daftar repair untuk discovery. SAPRAS & ADMIN (read-only untuk ADMIN). */
  @Get()
  findAll(@Query() query: ListRepairsQueryDto) {
    return this.repairs.findAll(query);
  }

  /** Mulai perbaikan. Hanya SAPRAS (ADMIN tidak menjalankan operasional). */
  @Post(':id/start')
  @HttpCode(200)
  @Roles(UserRole.SAPRAS)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RepairActionDto,
  ) {
    return this.repairs.start(user, id, dto);
  }

  /** Selesaikan perbaikan dan kembalikan unit ke AVAILABLE. Hanya SAPRAS. */
  @Post(':id/complete')
  @HttpCode(200)
  @Roles(UserRole.SAPRAS)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RepairActionDto,
  ) {
    return this.repairs.complete(user, id, dto);
  }

  /** Nyatakan tidak dapat diperbaiki (unit menjadi UNAVAILABLE). Hanya SAPRAS. */
  @Post(':id/unrepairable')
  @HttpCode(200)
  @Roles(UserRole.SAPRAS)
  unrepairable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RepairActionDto,
  ) {
    return this.repairs.markUnrepairable(user, id, dto);
  }

  /** Detail repair. SAPRAS & ADMIN (read-only untuk ADMIN). */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.repairs.findOne(id);
  }
}
