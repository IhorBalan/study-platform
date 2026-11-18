import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/user.js';
import { type Login, LoginSchema, type Signup, SignupSchema, type UpdateMe, UpdateMeSchema } from './users.schemas.js';
import { UsersService } from './users.service.js';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Public()
  @Post('auth/signup')
  signup(@Body({ schema: SignupSchema }) input: Signup): Promise<AuthUser> {
    return this.users.signup(input);
  }

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body({ schema: LoginSchema }) input: Login): Promise<{ token: string }> {
    return { token: await this.users.login(input) };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body({ schema: UpdateMeSchema }) input: UpdateMe): Promise<AuthUser> {
    return this.users.updateMe(user, input);
  }
}
