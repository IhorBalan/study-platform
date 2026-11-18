import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { DebugController } from './debug/debug.controller.js';
import { HealthController } from './health/health.controller.js';
import { NotesModule } from './notes/notes.module.js';

// TODO: provide the typed config, and register ProblemDetailsFilter under APP_FILTER.
// The checks create the app from AppModule and never run main.ts.
@Module({
  imports: [NotesModule],
  controllers: [HealthController, DebugController],
  providers: [{ provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() }],
})
export class AppModule {}
