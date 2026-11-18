import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../users/users.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { TokenService } from './token.service.js';

/**
 * Global and deny-by-default: every route needs a valid bearer token unless it is marked @Public().
 * A route someone forgets to annotate is closed, not open.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: unknown = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header) : null;
    const claims = match ? this.tokens.verify(match[1]) : null;
    // The token carries only the user id. The role is loaded fresh, so a demotion takes effect at once.
    const user = claims ? this.users.findById(claims.sub) : undefined;
    if (!user) throw new UnauthorizedException();

    request.user = user;
    return true;
  }
}
