import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DocumentsModule } from './documents/documents.module.js';

@Module({
  imports: [AuthModule, DocumentsModule, AdminModule],
})
export class AppModule {}
