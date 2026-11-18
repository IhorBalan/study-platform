import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser, Role } from './user.js';

export const IS_PUBLIC_KEY = 'auth:isPublic';
/** Reachable without a session token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Roles allowed on a route or controller: `@Roles(['admin'])`. */
export const Roles = Reflector.createDecorator<Role[]>();

/** The user that AuthGuard loaded for this request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
