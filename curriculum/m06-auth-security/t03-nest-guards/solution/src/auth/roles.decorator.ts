import { Reflector } from '@nestjs/core';
import type { Role } from '../users/user.js';

/** The roles allowed on a route or controller: `@Roles(['admin'])`. */
export const Roles = Reflector.createDecorator<Role[]>();
