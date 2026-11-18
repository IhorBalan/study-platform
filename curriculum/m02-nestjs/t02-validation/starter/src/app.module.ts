import { Module } from '@nestjs/common';
import { NotesModule } from './notes/notes.module.js';

// TODO: if you register a global pipe, do it here with the APP_PIPE token and not
// in main.ts. The checks create the app from AppModule and never run main.ts.
@Module({
  imports: [NotesModule],
})
export class AppModule {}
