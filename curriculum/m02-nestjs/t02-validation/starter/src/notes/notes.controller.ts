import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { CreateNoteInput, Note } from './note.js';
import { NotesService } from './notes.service.js';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  // TODO: `input` is whatever JSON the client sent. Validate it before it reaches the service.
  @Post()
  create(@Body() input: CreateNoteInput): Note {
    return this.notes.create(input);
  }

  @Get()
  list(): Note[] {
    return this.notes.list();
  }

  @Get(':id')
  find(@Param('id') id: string): Note {
    const note = this.notes.find(id);
    if (!note) throw new NotFoundException(`Note ${id} not found`);
    return note;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    if (!this.notes.remove(id)) throw new NotFoundException(`Note ${id} not found`);
  }
}
