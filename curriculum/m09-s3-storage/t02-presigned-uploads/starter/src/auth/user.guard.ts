// Stand-in for real authentication (module 6): the caller's id arrives in x-user-id.
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

const USER_ID = /^[a-z0-9-]{1,40}$/;

@Injectable()
export class UserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const id = req.header('x-user-id');
    if (!id || !USER_ID.test(id)) throw new UnauthorizedException('Send x-user-id');
    req.userId = id;
    return true;
  }
}
