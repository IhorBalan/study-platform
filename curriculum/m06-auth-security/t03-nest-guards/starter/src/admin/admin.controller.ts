import { Controller, Get } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';
import type { AuthUser } from '../users/user.js';

// TODO: only admins may use this controller. Use the Roles decorator from ../auth/roles.decorator.js.
@Controller('admin')
export class AdminController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  listUsers(): AuthUser[] {
    return this.users.list();
  }
}
