import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, Roles } from './decorators.js';
import { SessionsService } from './sessions.service.js';

/** Global, deny by default: every route needs a session unless it is marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const request = context.switchToHttp().getRequest();
    const match = /^Bearer ([\w-]{20,100})$/.exec(String(request.headers.authorization ?? ''));
    const user = match ? await this.sessions.userFor(match[1]) : undefined;
    if (!user) throw new UnauthorizedException();
    request.user = user;
    return true;
  }
}

/** Runs after AuthGuard. Routes without @Roles() are open to any signed-in user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride(Roles, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    if (!roles.includes(context.switchToHttp().getRequest().user?.role)) throw new ForbiddenException();
    return true;
  }
}
