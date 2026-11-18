import { Module } from '@nestjs/common';
import { StorageModule } from './storage/storage.module.js';
import { UploadsModule } from './uploads/uploads.module.js';

@Module({ imports: [StorageModule, UploadsModule] })
export class AppModule {}
