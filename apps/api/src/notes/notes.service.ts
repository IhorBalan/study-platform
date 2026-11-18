import { Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@study/db';
import type { NoteDto, NoteListItem } from '@study/shared';
import { eq } from 'drizzle-orm';
import { CurriculumService } from '../curriculum/curriculum.service.js';
import { InjectDb, type Database } from '../database/database.module.js';

const { notes } = schema;

/** The learner's own notes, one per lesson or task. */
@Injectable()
export class NotesService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly curriculum: CurriculumService,
  ) {}

  async get(itemId: string): Promise<NoteDto> {
    this.assertExists(itemId);
    const [row] = await this.db.select().from(notes).where(eq(notes.itemId, itemId));
    return row
      ? { body: row.body, updatedAt: row.updatedAt.toISOString() }
      : { body: '', updatedAt: null };
  }

  /** Every note, in plan order, with the title of what it is about. */
  async list(): Promise<NoteListItem[]> {
    const rows = await this.db.select().from(notes);
    const byId = new Map(rows.map((row) => [row.itemId, row]));
    const items: NoteListItem[] = [];
    for (const m of this.curriculum.allModules()) {
      const entries = [
        ...m.lessons.map((l) => ({ kind: 'lesson' as const, id: l.id, title: l.title })),
        ...m.tasks.map((t) => ({ kind: 'task' as const, id: t.id, title: t.title })),
      ];
      for (const entry of entries) {
        const row = byId.get(entry.id);
        if (!row) continue;
        items.push({
          kind: entry.kind,
          itemId: entry.id,
          title: entry.title,
          moduleTitle: m.title,
          body: row.body,
          updatedAt: row.updatedAt.toISOString(),
        });
      }
    }
    return items;
  }

  async save(itemId: string, body: string): Promise<NoteDto> {
    this.assertExists(itemId);
    // A note of only spaces is no note.
    if (body.trim() === '') {
      await this.db.delete(notes).where(eq(notes.itemId, itemId));
      return { body: '', updatedAt: null };
    }
    const [row] = await this.db
      .insert(notes)
      .values({ itemId, body })
      .onConflictDoUpdate({ target: notes.itemId, set: { body, updatedAt: new Date() } })
      .returning();
    if (!row) throw new Error('note was not saved');
    return { body: row.body, updatedAt: row.updatedAt.toISOString() };
  }

  /** Notes belong to a lesson or task that exists; anything else is a 404. */
  private assertExists(itemId: string): void {
    try {
      this.curriculum.lesson(itemId);
    } catch {
      try {
        this.curriculum.task(itemId);
      } catch {
        throw new NotFoundException(`No lesson or task "${itemId}" exists`);
      }
    }
  }
}
