import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    TokenService,
    // TODO: register AuthGuard and RolesGuard as global guards (APP_GUARD from @nestjs/core).
    // The order of registration is the order they run in.
  ],
})
export class AuthModule {}
