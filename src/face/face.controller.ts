import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { RegisterFaceProfileDto } from './dto/register-face-profile.dto';
import { FaceService } from './face.service';

@Controller('face')
@Roles(UserRole.SISWA, UserRole.GURU)
export class FaceController {
  constructor(private readonly face: FaceService) {}

  /** Dipakai frontend setelah login: belum ada face profile -> arahkan ke Face Registration. */
  @Get('profile/status')
  async status(@CurrentUser('userId') userId: string) {
    return { hasFaceProfile: await this.face.hasFaceProfile(userId) };
  }

  /**
   * Registrasi wajah milik user yang login. `userId` SELALU dari JWT, bukan body,
   * sehingga user tidak dapat mendaftarkan wajah user lain (IDOR).
   */
  @Post('profile')
  register(
    @CurrentUser('userId') userId: string,
    @Body() dto: RegisterFaceProfileDto,
  ) {
    return this.face.register(userId, dto.faceTemplate);
  }
}
