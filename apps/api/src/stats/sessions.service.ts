import { Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@study/db';
import type { StartSession, UpdateSession } from '@study/shared';
import { eq, sql } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.module.js';

const { studySessions } = schema;

/** Records time actually spent. The browser reports active seconds; idle tabs do not count. */
@Injectable()
export class SessionsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async start(input: StartSession): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(studySessions)
      .values({ activity: input.activity, itemId: input.itemId ?? null })
      .returning({ id: studySessions.id });
    if (!row) throw new Error('session was not created');
    return row;
  }

  async update(id: string, input: UpdateSession): Promise<void> {
    const rows = await this.db
      .update(studySessions)
      .set({
        // Heartbeats can arrive out of order; the count never goes down.
        activeSeconds: sql`greatest(${studySessions.activeSeconds}, ${input.activeSeconds})`,
        endedAt: new Date(),
      })
      .where(eq(studySessions.id, id))
      .returning({ id: studySessions.id });
    if (rows.length === 0) throw new NotFoundException(`Session "${id}" does not exist`);
  }
}
