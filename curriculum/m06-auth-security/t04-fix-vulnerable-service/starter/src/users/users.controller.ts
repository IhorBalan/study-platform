import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/user.js';
import { UsersService } from './users.service.js';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Public()
  @Post('auth/signup')
  signup(@Body() input: Record<string, unknown>): Promise<AuthUser> {
    return this.users.signup(input);
  }

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() input: Record<string, unknown>): Promise<{ token: string }> {
    return { token: await this.users.login(input) };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() input: Record<string, unknown>): Promise<AuthUser> {
    return this.users.updateMe(user, input);
  }
}
