import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../common/enums';
import { comparePassword, getDummyHash } from '../common/utils/password.util';
import { FaceService } from '../face/face.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

const NEEDS_FACE = [UserRole.SISWA, UserRole.GURU];

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly face: FaceService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.users.findForLogin(dto.identifier);

    // Selalu jalankan bcrypt (hash palsu bila user tidak ada) agar waktu respons
    // dan pesan error sama: tidak membocorkan apakah NIS/NIK/email terdaftar.
    const valid = await comparePassword(
      dto.password,
      user?.passwordHash ?? (await getDummyHash()),
    );
    if (!user || !valid) throw new UnauthorizedException('Identifier atau password salah');

    // Sengaja dicek SETELAH password valid supaya status akun tidak bisa ditebak tanpa password.
    if (!user.isActive) {
      throw new ForbiddenException({
        message: 'Akun Anda tidak aktif. Hubungi admin sekolah.',
        code: 'ACCOUNT_INACTIVE',
      });
    }

    const role = user.role.name as UserRole;
    // Payload minimal: tanpa password / password_hash / face_template.
    const accessToken = await this.jwt.signAsync({ userId: user.id, role });
    const hasFaceProfile = await this.face.hasFaceProfile(user.id);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN') ?? '8h',
      mustChangePassword: user.mustChangePassword,
      hasFaceProfile,
      faceRegistrationRequired: NEEDS_FACE.includes(role) && !hasFaceProfile,
      user: UserResponseDto.from(user),
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('Password baru harus berbeda dari password saat ini');
    }
    const ok = await this.users.changeOwnPassword(userId, dto.currentPassword, dto.newPassword);
    if (!ok) throw new BadRequestException('Password saat ini salah');
    return { message: 'Password berhasil diubah' };
  }

  async me(userId: string) {
    const [user, hasFaceProfile] = await Promise.all([
      this.users.findOne(userId),
      this.face.hasFaceProfile(userId),
    ]);
    return {
      user,
      hasFaceProfile,
      faceRegistrationRequired: NEEDS_FACE.includes(user.role as UserRole) && !hasFaceProfile,
    };
  }
}
