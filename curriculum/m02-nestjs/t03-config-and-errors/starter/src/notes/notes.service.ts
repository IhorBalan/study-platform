import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CreateNoteInput, Note } from './note.js';

/**
 * Owns the notes. It knows nothing about HTTP: a missing note is `undefined`
 * or `false`, and the controller decides what that means for the client.
 */
@Injectable()
export class NotesService {
  // A Map keeps insertion order, so `list()` returns notes oldest first.
  private readonly notes = new Map<string, Note>();

  // TODO: inject the typed config. When MAX_NOTES notes are already stored,
  // refuse to create another one by throwing a domain error (a plain Error
  // subclass, not an HttpException). The client must see a 409 problem.
  create(input: CreateNoteInput): Note {
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
