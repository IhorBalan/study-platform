import { schema } from '@study/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { DB, type Database } from '../../src/database/database.module.js';
import { WeakSkillsService } from '../../src/srs/weak-skills.service.js';
import type { E2eContext } from './context.js';

export function spacedRepetitionTests(ctx: E2eContext): void {
  describe('spaced repetition', () => {
    it('queues the lesson deck as new cards with a preview for each grade', async () => {
      const res = await ctx.http().get('/api/review/queue').expect(200);
      expect(res.body.counts).toMatchObject({ due: 0, newAvailable: 2, reviewedToday: 0 });
      expect(res.body.cards).toHaveLength(2);
      expect(res.body.cards[0]).toMatchObject({ front: 'Q1', state: 'new', source: 'lesson' });
      expect(Object.keys(res.body.cards[0].preview).sort()).toEqual([
        'again',
        'easy',
        'good',
        'hard',
      ]);
    });

    it('creates a manual card that is active at once', async () => {
      const res = await ctx
        .http()
        .post('/api/cards')
        .send({
          type: 'term',
          front: ' Idempotency key ',
          back: 'A client-chosen id',
          skills: ['http-basics'],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        front: 'Idempotency key',
        source: 'manual',
        status: 'active',
        state: 'new',
        skills: ['http-basics'],
      });

      // A queue narrowed to one module holds that module's lesson cards only.
      const all = await ctx.http().get('/api/review/queue').expect(200);
      const focused = await ctx.http().get('/api/review/queue?module=m00-demo').expect(200);
      const fronts = (body: { cards: { front: string }[] }) => body.cards.map((c) => c.front);
      expect(fronts(all.body)).toContain('Idempotency key');
      expect(fronts(focused.body)).toEqual(['Q1', expect.any(String)]);
      expect(focused.body.counts.newAvailable).toBe(all.body.counts.newAvailable - 1);
      await ctx.http().get('/api/review/queue?module=m99-missing').expect(404);
      await ctx.http().get('/api/review/queue?module=Not_An_Id').expect(400);
    });

    it('rejects a card that refers to an unknown skill', async () => {
      const res = await ctx
        .http()
        .post('/api/cards')
        .send({ type: 'term', front: 'x', back: 'y', skills: ['nope'] })
        .expect(400);
      expect(res.body.detail).toContain('Unknown skill');
    });

    it('reschedules a card into the future when it is graded good', async () => {
      const queue = await ctx.http().get('/api/review/queue').expect(200);
      const card = queue.body.cards[0];

      const res = await ctx
        .http()
        .post(`/api/review/${card.id}`)
        .send({ grade: 'good', answerMs: 4200 })
        .expect(200);
      expect(res.body.state).not.toBe('new');
      expect(new Date(res.body.due).getTime()).toBeGreaterThan(Date.now());
      // The preview promised the same due date, to the second.
      expect(
        Math.abs(new Date(res.body.due).getTime() - new Date(card.preview.good).getTime()),
      ).toBeLessThan(5000);

      const after = await ctx.http().get('/api/review/queue').expect(200);
      expect(after.body.cards.map((c: { id: string }) => c.id)).not.toContain(card.id);
      expect(after.body.counts.reviewedToday).toBe(1);
      // The card just graded is the only one scheduled, so it is the next one due.
      expect(after.body.nextDue).toBe(res.body.due);
      // Too few timed reviews to measure a pace, so the default stands.
      expect(after.body.secondsPerCard).toBe(8);
    });

    it('survives a second review of the same card (stored state round-trips)', async () => {
      const list = await ctx.http().get('/api/cards').expect(200);
      const reviewed = list.body.cards.find((c: { reps: number }) => c.reps === 1);

      // Not due yet: a repeated or concurrent grade is refused and changes nothing.
      const early = await ctx.http().post(`/api/review/${reviewed.id}`).send({ grade: 'again' });
      expect(early.status).toBe(409);

      await ctx.makeDue(reviewed.id);
      const [first, second] = await Promise.all([
        ctx.http().post(`/api/review/${reviewed.id}`).send({ grade: 'good' }),
        ctx.http().post(`/api/review/${reviewed.id}`).send({ grade: 'again' }),
      ]);
      expect([first.status, second.status].toSorted()).toEqual([200, 409]);

      // The grade is saved before the weak-skill list is updated. If that update
      // fails, the grade still counts and the request still succeeds.
      await ctx.makeDue(reviewed.id);
      const evaluate = vi
        .spyOn(ctx.app.get(WeakSkillsService), 'evaluate')
        .mockRejectedValueOnce(new Error('evaluation failed'));
      const res = await ctx
        .http()
        .post(`/api/review/${reviewed.id}`)
        .send({ grade: 'again' })
        .expect(200);
      expect(evaluate).toHaveBeenCalledOnce();
      evaluate.mockRestore();
      expect(['learning', 'relearning', 'review']).toContain(res.body.state);
      const again = await ctx.http().get('/api/cards').expect(200);
      expect(again.body.cards.find((c: { id: string }) => c.id === reviewed.id).reps).toBe(3);
    });

    it('undoes the latest grade and restores the schedule exactly', async () => {
      const list = await ctx.http().get('/api/cards').expect(200);
      const target = list.body.cards.find((c: { reps: number }) => c.reps === 3);
      await ctx.makeDue(target.id);
      const before = (await ctx.http().get('/api/cards').expect(200)).body.cards.find(
        (c: { id: string }) => c.id === target.id,
      );
      const reviewedBefore = (await ctx.http().get('/api/review/queue').expect(200)).body.counts
        .reviewedToday;

      await ctx.http().post(`/api/review/${target.id}`).send({ grade: 'easy' }).expect(200);
      const undone = await ctx.http().post(`/api/review/${target.id}/undo`).expect(200);
      expect(undone.body.due).toBe(before.due);

      const after = (await ctx.http().get('/api/cards').expect(200)).body.cards.find(
        (c: { id: string }) => c.id === target.id,
      );
      expect(after).toEqual(before);
      const queue = await ctx.http().get('/api/review/queue').expect(200);
      expect(queue.body.counts.reviewedToday).toBe(reviewedBefore);

      // A new grade can be undone again.
      await ctx.http().post(`/api/review/${target.id}`).send({ grade: 'good' }).expect(200);
      await ctx.http().post(`/api/review/${target.id}/undo`).expect(200);

      await ctx.http().post('/api/review/00000000-0000-4000-8000-000000000000/undo').expect(404);
    });

    it('refuses to undo a grade that is more than ten minutes old', async () => {
      const list = await ctx.http().get('/api/cards').expect(200);
      const target = list.body.cards.find((c: { reps: number }) => c.reps === 3);
      await ctx.makeDue(target.id);
      await ctx.http().post(`/api/review/${target.id}`).send({ grade: 'good' }).expect(200);
      await ctx.app
        .get<Database>(DB)
        .update(schema.reviews)
        .set({ reviewedAt: new Date(Date.now() - 11 * 60_000) })
        .where(eq(schema.reviews.cardId, target.id));
      const res = await ctx.http().post(`/api/review/${target.id}/undo`);
      expect(res.status).toBe(409);
      expect(res.body.detail ?? res.body.message).toMatch(/10 minutes/);
    });

    it('allows one open refresh per skill', async () => {
      const db = ctx.app.get<Database>(DB);
      const [skill] = await db.select().from(schema.skills).limit(1);
      const row = { skillId: skill!.id, reason: 'test' };
      const [first] = await db.insert(schema.reviewTasks).values(row).returning();
      await expect(db.insert(schema.reviewTasks).values(row)).rejects.toMatchObject({
        cause: { constraint: 'review_tasks_open_skill_idx' },
      });
      const ignored = await db
        .insert(schema.reviewTasks)
        .values(row)
        .onConflictDoNothing()
        .returning();
      expect(ignored).toHaveLength(0);
      await db.delete(schema.reviewTasks).where(eq(schema.reviewTasks.id, first!.id));
    });

    it('respects the daily limit for new cards', async () => {
      await ctx.http().patch('/api/settings').send({ newCardsPerDay: 1 }).expect(200);
      const res = await ctx.http().get('/api/review/queue').expect(200);
      // One new card was already introduced today, so none are left.
      expect(res.body.counts.newAvailable).toBe(0);
      expect(res.body.cards.every((c: { state: string }) => c.state !== 'new')).toBe(true);
      await ctx.http().patch('/api/settings').send({ newCardsPerDay: 10 }).expect(200);
    });

    it('does not let a suspended card be reviewed', async () => {
      const list = await ctx.http().get('/api/cards?status=active').expect(200);
      const target = list.body.cards.find((c: { state: string }) => c.state === 'new');
      await ctx.http().patch(`/api/cards/${target.id}`).send({ status: 'suspended' }).expect(200);
      const res = await ctx.http().post(`/api/review/${target.id}`).send({ grade: 'good' });
      expect(res.status).toBe(409);
    });

    it('does not let a card be moved back to waiting for approval', async () => {
      const list = await ctx.http().get('/api/cards?status=active').expect(200);
      const target = list.body.cards[0];
      const res = await ctx.http().patch(`/api/cards/${target.id}`).send({ status: 'pending' });
      expect(res.status).toBe(400);
    });

    it('validates settings', async () => {
      const res = await ctx.http().patch('/api/settings').send({ desiredRetention: 1.5 });
      expect(res.status).toBe(400);
      for (const body of [
        { reviewMode: 'api' },
        { labRepoPath: '' },
        { labRepoPath: 'some/dir' },
      ]) {
        const bad = await ctx.http().patch('/api/settings').send(body);
        expect(bad.status).toBe(400);
      }
      await ctx.http().patch('/api/settings').send({ labRepoPath: '/tmp/lab' }).expect(200);
      await ctx.http().patch('/api/settings').send({ labRepoPath: null }).expect(200);
    });
  });
}
