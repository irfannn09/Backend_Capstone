import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Guard global. Alur:
 * 1. @Public -> lolos.
 * 2. Verifikasi JWT (HS256).
 * 3. Muat user dari DB: token milik akun yang dinonaktifkan/dihapus langsung ditolak,
 *    dan role yang dipakai adalah role TERKINI dari database.
 * 4. must_change_password = true -> hanya endpoint @AllowMustChangePassword.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Token autentikasi tidak ditemukan');

    let payload: { userId?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Token tidak valid atau sudah kedaluwarsa');
    }
    if (typeof payload.userId !== 'string' || !isUUID(payload.userId)) {
      throw new UnauthorizedException('Token tidak valid atau sudah kedaluwarsa');
    }

    const user = await this.users.findAuthUser(payload.userId);
    if (!user) throw new UnauthorizedException('Token tidak valid atau akun tidak aktif');

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE_PASSWORD_KEY, targets);
    if (user.mustChangePassword && !allowed) {
      throw new ForbiddenException({
        message: 'Anda harus mengganti password terlebih dahulu',
        code: 'MUST_CHANGE_PASSWORD',
      });
    }

    request.user = user;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' && token ? token : undefined;
  }
}
