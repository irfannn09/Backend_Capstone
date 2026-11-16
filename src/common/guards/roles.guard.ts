import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Otorisasi berbasis role. Tidak ada "super role": ADMIN tidak otomatis lolos
 * ke endpoint SAPRAS (dan sebaliknya).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Anda tidak memiliki akses ke resource ini');
    }
    return true;
  }
}
