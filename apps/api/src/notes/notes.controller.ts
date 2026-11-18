import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { SaveNote, type NoteDto } from '@study/shared';
import { NotesService } from './notes.service.js';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get(':moduleId/:slug')
  get(@Param('moduleId') moduleId: string, @Param('slug') slug: string): Promise<NoteDto> {
    return this.notes.get(`${moduleId}/${slug}`);
  }

  @Put(':moduleId/:slug')
  save(
    @Param('moduleId') moduleId: string,
    @Param('slug') slug: string,
    @Body({ schema: SaveNote }) body: SaveNote,
  ): Promise<NoteDto> {
    return this.notes.save(`${moduleId}/${slug}`, body.body);
  }
}
