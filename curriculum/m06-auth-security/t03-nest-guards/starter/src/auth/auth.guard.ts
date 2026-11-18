import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

/**
 * TODO: authenticate every request unless the route or its controller is marked @Public().
 * - Read `Authorization: Bearer <token>` and check it with TokenService.verify().
 * - Load the user with UsersService.findById(claims.sub) and put it on `request.user`.
 * - Anything missing or invalid: throw UnauthorizedException (401).
 * Hint: inject Reflector and use getAllAndOverride(IS_PUBLIC_KEY, [handler, class]).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
