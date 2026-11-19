import { schema } from '@study/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DeckSyncService } from '../../src/curriculum/deck-sync.service.js';
import { DB, type Database } from '../../src/database/database.module.js';
import type { E2eContext } from './context.js';

export function curriculumUpdatesTests(ctx: E2eContext): void {
  describe('curriculum updates', () => {
    it('brings the cards of finished lessons up to date and respects the learner', async () => {
      const db = ctx.app.get<Database>(DB);
      const decks = ctx.app.get(DeckSyncService);
      const key = (id: string) => `m00-demo/l01-first#${id}`;
      const card = async (id: string) =>
        (
          await db
            .select()
            .from(schema.cards)
            .where(eq(schema.cards.sourceKey, key(id)))
        )[0];
      const schedule = async (cardId: string) =>
        (
          await db
            .select()
            .from(schema.cardSchedules)
            .where(eq(schema.cardSchedules.cardId, cardId))
        )[0];
      await decks.sync();

      // As if the first card had different wording when the lesson was finished,
      // and the second card was written after that.
      const first = await card('c1');
      if (!first) throw new Error('fixture card missing');
      await db
        .update(schema.cards)
        .set({ front: 'Old wording' })
        .where(eq(schema.cards.id, first.id));
      await db.delete(schema.cards).where(eq(schema.cards.sourceKey, key('c2')));
      const scheduleBefore = await schedule(first.id);

      expect(await decks.sync()).toEqual({ updated: 1, added: 1, retagged: 0 });
      expect((await card('c1'))?.front).toBe('Q1');
      // Only the text changes: the card keeps its place in the schedule.
      expect(await schedule(first.id)).toEqual(scheduleBefore);
      const second = await card('c2');
      expect(second).toMatchObject({ front: 'Q2', status: 'active', source: 'lesson' });
      expect(await decks.sync()).toEqual({ updated: 0, added: 0, retagged: 0 });

      // A skill tag that changed in the files reaches the card the learner has.
      const tags = async () =>
        (
          await db.select().from(schema.cardSkills).where(eq(schema.cardSkills.cardId, first.id))
        ).map((l) => l.skillId);
      const tagged = await tags();
      expect(tagged).toEqual(['http-basics']);
      await db.delete(schema.cardSkills).where(eq(schema.cardSkills.cardId, first.id));
      expect(await decks.sync()).toEqual({ updated: 0, added: 0, retagged: 1 });
      expect(await tags()).toEqual(tagged);

      // Saving the same text again is not an edit: corrections still arrive.
      await ctx
        .http()
        .patch(`/api/cards/${first.id}`)
        .send({ type: first.type, front: 'Q1', back: first.back })
        .expect(200);
      expect((await card('c1'))?.editedAt).toBeNull();

      // A card the learner reworded, and one they deleted, are left alone.
      await ctx.http().patch(`/api/cards/${first.id}`).send({ front: 'My wording' }).expect(200);
      await ctx.http().delete(`/api/cards/${second?.id}`).expect(204);
      expect(await decks.sync()).toEqual({ updated: 0, added: 0, retagged: 0 });
      expect((await card('c1'))?.front).toBe('My wording');
      expect(await card('c2')).toBeUndefined();
      const again = await ctx
        .http()
        .put('/api/lessons/m00-demo/l01-first/progress')
        .send({ status: 'done' })
        .expect(200);
      expect(again.body.cardsAdded).toBe(0);
    });
  });
}
