import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/** @CurrentUser() -> seluruh objek, @CurrentUser('userId') -> satu field. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    return field ? user?.[field] : user;
  },
);
