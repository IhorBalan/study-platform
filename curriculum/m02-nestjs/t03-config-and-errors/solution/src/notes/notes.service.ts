import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import type { CreateNoteInput, Note } from './note.js';
import { NotesLimitReachedError } from './notes-limit-reached.error.js';

/**
 * Owns the notes. It knows nothing about HTTP: a missing note is `undefined`
 * or `false`, and a full store is a domain error.
 */
@Injectable()
export class NotesService {
  // A Map keeps insertion order, so `list()` returns notes oldest first.
  private readonly notes = new Map<string, Note>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  create(input: CreateNoteInput): Note {
    if (this.notes.size >= this.env.MAX_NOTES) {
      throw new NotesLimitReachedError(this.env.MAX_NOTES);
    }
    const note: Note = {
      id: randomUUID(),
      title: input.title,
      body: input.body ?? '',
      createdAt: new Date().toISOString(),
    };
    this.notes.set(note.id, note);
    return note;
  }

  list(): Note[] {
    return [...this.notes.values()];
  }

  find(id: string): Note | undefined {
    return this.notes.get(id);
  }

  remove(id: string): boolean {
    return this.notes.delete(id);
  }
}
