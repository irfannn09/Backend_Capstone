import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateHandoverDto } from './dto/create-handover.dto';
import { HandoversService } from './handovers.service';

@Controller('handovers')
@Roles(UserRole.SAPRAS, UserRole.ADMIN)
export class HandoversController {
  constructor(private readonly handovers: HandoversService) {}

  /** Penyerahan barang. Hanya SAPRAS (ADMIN tidak menjalankan operasional). */
  @Post()
  @Roles(UserRole.SAPRAS)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateHandoverDto,
  ) {
    return this.handovers.create(user, dto);
  }

  /** Riwayat handover. SAPRAS & ADMIN (read-only untuk ADMIN). */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.handovers.findOne(id);
  }
}
