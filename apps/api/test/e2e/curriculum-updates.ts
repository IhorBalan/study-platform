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

      expect(await decks.sync()).toEqual({
        updated: 1,
        added: 1,
        retagged: 0,
        retired: 0,
        restored: 0,
      });
      expect((await card('c1'))?.front).toBe('Q1');
      // Only the text changes: the card keeps its place in the schedule.
      expect(await schedule(first.id)).toEqual(scheduleBefore);
      const second = await card('c2');
      expect(second).toMatchObject({ front: 'Q2', status: 'active', source: 'lesson' });
      expect(await decks.sync()).toEqual({
        updated: 0,
        added: 0,
        retagged: 0,
        retired: 0,
        restored: 0,
      });

      // A skill tag that changed in the files reaches the card the learner has.
      const tags = async () =>
        (
          await db.select().from(schema.cardSkills).where(eq(schema.cardSkills.cardId, first.id))
        ).map((l) => l.skillId);
      const tagged = await tags();
      expect(tagged).toEqual(['http-basics']);
      await db.delete(schema.cardSkills).where(eq(schema.cardSkills.cardId, first.id));
      expect(await decks.sync()).toEqual({
        updated: 0,
        added: 0,
        retagged: 1,
        retired: 0,
        restored: 0,
      });
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
      expect(await decks.sync()).toEqual({
        updated: 0,
        added: 0,
        retagged: 0,
        retired: 0,
        restored: 0,
      });
      expect((await card('c1'))?.front).toBe('My wording');
      expect(await card('c2')).toBeUndefined();
      const again = await ctx
        .http()
        .put('/api/lessons/m00-demo/l01-first/progress')
        .send({ status: 'done' })
        .expect(200);
      expect(again.body.cardsAdded).toBe(0);
    });

    it('suspends a card that was removed from the curriculum, once', async () => {
      const db = ctx.app.get<Database>(DB);
      const decks = ctx.app.get(DeckSyncService);
      // As if the lesson had a third card when the learner finished it, and the
      // card was later removed from the files as a duplicate.
      const [gone] = await db
        .insert(schema.cards)
        .values({
          type: 'concept',
          front: 'A question that was removed',
          back: 'Its answer',
          source: 'lesson',
          status: 'active',
          lessonId: 'm00-demo/l01-first',
          sourceKey: 'm00-demo/l01-first#removed-later',
        })
        .returning();
      if (!gone) throw new Error('could not add the card');
      await db.insert(schema.cardSchedules).values({ cardId: gone.id, due: new Date(0) });
      const status = async () =>
        (await db.select().from(schema.cards).where(eq(schema.cards.id, gone.id)))[0]?.status;
      const queued = async () => {
        const res = await ctx.http().get('/api/review/queue').expect(200);
        return JSON.stringify(res.body).includes(gone.id);
      };
      expect(await queued()).toBe(true);

      expect((await decks.sync()).retired).toBe(1);
      expect(await status()).toBe('suspended');
      expect(await queued()).toBe(false);
      // The row and its schedule are kept.
      expect(
        await db
          .select()
          .from(schema.cardSchedules)
          .where(eq(schema.cardSchedules.cardId, gone.id)),
      ).toHaveLength(1);

      // The learner can take it back, and the next update leaves it alone.
      await ctx.http().patch(`/api/cards/${gone.id}`).send({ status: 'active' }).expect(200);
      expect((await decks.sync()).retired).toBe(0);
      expect(await status()).toBe('active');
      await ctx.http().delete(`/api/cards/${gone.id}`).expect(204);
    });

    it('makes a retired card active again when it is back in the curriculum', async () => {
      const db = ctx.app.get<Database>(DB);
      const decks = ctx.app.get(DeckSyncService);
      // The second fixture card, as it looks after an update retired it: the row is
      // suspended and its key is remembered. Now the files hold the card again.
      const sourceKey = 'm00-demo/l01-first#c2';
      await db.delete(schema.cards).where(eq(schema.cards.sourceKey, sourceKey));
      const [back] = await db
        .insert(schema.cards)
        .values({
          type: 'concept',
          front: 'Q2',
          back: 'A2',
          source: 'lesson',
          status: 'suspended',
          lessonId: 'm00-demo/l01-first',
          sourceKey,
        })
        .returning();
      if (!back) throw new Error('could not add the card');
      await db.insert(schema.cardSchedules).values({ cardId: back.id, due: new Date(0) });
      await db.insert(schema.removedLessonCards).values({ sourceKey }).onConflictDoNothing();
      const marker = () =>
        db
          .select()
          .from(schema.removedLessonCards)
          .where(eq(schema.removedLessonCards.sourceKey, sourceKey));

      expect((await decks.sync()).restored).toBe(1);
      const [row] = await db.select().from(schema.cards).where(eq(schema.cards.id, back.id));
      expect(row?.status).toBe('active');
      expect(await marker()).toHaveLength(0);
      const queue = await ctx.http().get('/api/review/queue').expect(200);
      expect(JSON.stringify(queue.body)).toContain(back.id);

      // A card the learner suspended has no marker and stays suspended.
      await ctx.http().patch(`/api/cards/${back.id}`).send({ status: 'suspended' }).expect(200);
      expect((await decks.sync()).restored).toBe(0);
      const [still] = await db.select().from(schema.cards).where(eq(schema.cards.id, back.id));
      expect(still?.status).toBe('suspended');

      // A retired card the learner resumed before it came back to the files: the
      // marker goes at the next update, so a later suspension is the learner's own.
      await ctx.http().patch(`/api/cards/${back.id}`).send({ status: 'active' }).expect(200);
      await db.insert(schema.removedLessonCards).values({ sourceKey }).onConflictDoNothing();
      expect((await decks.sync()).restored).toBe(0);
      expect(await marker()).toHaveLength(0);
      await ctx.http().patch(`/api/cards/${back.id}`).send({ status: 'suspended' }).expect(200);
      expect((await decks.sync()).restored).toBe(0);
      const [kept] = await db.select().from(schema.cards).where(eq(schema.cards.id, back.id));
      expect(kept?.status).toBe('suspended');

      // Back to how the earlier test left it: deleted by the learner.
      await ctx.http().delete(`/api/cards/${back.id}`).expect(204);
      expect(await marker()).toHaveLength(1);
    });
  });
}
