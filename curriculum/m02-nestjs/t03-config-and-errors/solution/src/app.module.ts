import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { ConfigModule } from './config/config.module.js';
import { DebugController } from './debug/debug.controller.js';
import { HealthController } from './health/health.controller.js';
import { NotesModule } from './notes/notes.module.js';

@Module({
  imports: [ConfigModule, NotesModule],
  controllers: [HealthController, DebugController],
  providers: [
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
    // useClass lets Nest construct the filter, so it could inject providers if it needed any.
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
