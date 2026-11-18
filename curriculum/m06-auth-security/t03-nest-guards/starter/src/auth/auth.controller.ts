import { Body, Controller, Get, HttpCode, HttpStatus, Post, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';
import type { AuthUser } from '../users/user.js';
import { CurrentUser } from './current-user.decorator.js';
import { Public } from './public.decorator.js';
import { TokenService } from './token.service.js';

@Controller()
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: { username?: unknown; password?: unknown }) {
    const user = await this.users.checkCredentials(body?.username, body?.password);
    // One message for "no such user" and "wrong password": do not help anyone enumerate accounts.
    if (!user) throw new UnauthorizedException('Invalid username or password');
    return { accessToken: this.tokens.issue({ sub: user.id }) };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
