import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../users/user.js';

/** The user the authentication guard put on the request. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
