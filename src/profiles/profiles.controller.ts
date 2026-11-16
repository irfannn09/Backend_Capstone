import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { ProfilesService } from './profiles.service';

/**
 * Hanya profile MILIK SENDIRI (userId diambil dari JWT, bukan dari URL/body),
 * sehingga user lain mustahil dibaca/diubah. SAPRAS/ADMIN tidak punya profile.
 */
@Controller('profiles')
@Roles(UserRole.SISWA, UserRole.GURU)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me')
  getMine(@CurrentUser('userId') userId: string) {
    return this.profiles.getMine(userId);
  }

  @Patch('me')
  updateMine(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMyProfileDto) {
    return this.profiles.updateMine(user, dto);
  }
}
