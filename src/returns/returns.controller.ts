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
import { CreateReturnDto } from './dto/create-return.dto';
import { ReturnsService } from './returns.service';

@Controller('returns')
@Roles(UserRole.SAPRAS, UserRole.ADMIN)
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  /** Penerimaan kembali barang. Hanya SAPRAS. */
  @Post()
  @Roles(UserRole.SAPRAS)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReturnDto,
  ) {
    return this.returns.create(user, dto);
  }

  /** Riwayat return. SAPRAS & ADMIN (read-only untuk ADMIN). */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.returns.findOne(id);
  }
}
