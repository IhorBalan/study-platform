import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { DbModule } from './db/db.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [DbModule, AuthModule, UsersModule, InvoicesModule],
  providers: [{ provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() }],
})
export class AppModule {}
