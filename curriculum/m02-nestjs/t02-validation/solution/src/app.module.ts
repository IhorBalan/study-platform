import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { NotesModule } from './notes/notes.module.js';

@Module({
  imports: [NotesModule],
  providers: [
    // Registered through the container, not in main.ts, so every way of
    // creating the app (main.ts, tests) gets the same validation.
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
  ],
})
export class AppModule {}
