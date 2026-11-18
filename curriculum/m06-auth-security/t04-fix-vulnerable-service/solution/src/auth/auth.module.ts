import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, RolesGuard } from './guards.js';
import { SessionsService } from './sessions.service.js';

@Module({
  providers: [
    SessionsService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SessionsService],
})
export class AuthModule {}
