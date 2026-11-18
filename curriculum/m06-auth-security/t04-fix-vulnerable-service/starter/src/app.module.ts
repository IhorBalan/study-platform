import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { DbModule } from './db/db.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [DbModule, AuthModule, UsersModule, InvoicesModule],
})
export class AppModule {}
