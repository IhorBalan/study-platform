import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

/**
 * TODO: read the roles set with @Roles([...]) on the handler or its controller.
 * No roles: allow. Otherwise allow only when request.user.role is one of them,
 * and throw ForbiddenException (403) when it is not.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
