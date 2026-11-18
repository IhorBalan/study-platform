import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { UsersService } from '../users/users.service.js';
import type { AuthUser } from '../users/user.js';

@Roles(['admin'])
@Controller('admin')
export class AdminController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  listUsers(): AuthUser[] {
    return this.users.list();
  }
}
