import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ChatModule } from './chat/chat.module.js';

@Module({
  imports: [ChatModule],
  providers: [{ provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() }],
})
export class AppModule {}
