import { Injectable } from '@nestjs/common';
import { schema } from '@study/db';
import { Editor, type SettingsDto, type UpdateSettings } from '@study/shared';
import { eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.module.js';

@Injectable()
export class SettingsService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * The settings table has exactly one row. It is created the first time it is
   * found missing, so an ordinary read is one select and no write.
   */
  async get(): Promise<SettingsDto> {
    const { settings } = schema;
    const read = () => this.db.select().from(settings).where(eq(settings.id, 1));
    let [row] = await read();
    if (!row) {
      await this.db.insert(settings).values({ id: 1 }).onConflictDoNothing();
      [row] = await read();
    }
    if (!row) throw new Error('settings row is missing');
    return {
      reviewMode: row.reviewMode,
      newCardsPerDay: row.newCardsPerDay,
      reviewsPerDay: row.reviewsPerDay,
      desiredRetention: row.desiredRetention,
      labRepoPath: row.labRepoPath,
      // The column is plain text; anything unknown falls back to no link.
      editor: Editor.safeParse(row.editor).data ?? 'none',
    };
  }

  async update(patch: UpdateSettings): Promise<SettingsDto> {
    await this.get();
    if (Object.keys(patch).length > 0) {
      await this.db.update(schema.settings).set(patch).where(eq(schema.settings.id, 1));
    }
    return this.get();
  }
}
