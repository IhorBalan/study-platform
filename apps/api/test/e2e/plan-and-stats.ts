import { schema } from '@study/db';
import { and, eq, ne } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DB, type Database } from '../../src/database/database.module.js';
import type { E2eContext } from './context.js';

export function planAndStatsTests(ctx: E2eContext): void {
  describe('plan, time and statistics', () => {
    it('points to the next lesson and lists open tasks', async () => {
      const res = await ctx.http().get('/api/plan').expect(200);
      const { nextUp, modules } = res.body;
      expect(nextUp.lesson).toMatchObject({ moduleTitle: 'Demo module' });
      const tasks = modules[0].tasks;
      // The written answer has a stored review; the code task was submitted but never passed.
      expect(tasks.find((t: { id: string }) => t.id === 'm00-demo/t01-explain').status).toBe(
        'done',
      );
      expect(tasks.find((t: { id: string }) => t.id === 'm00-demo/t02-code').status).toBe(
        'in_progress',
      );
      expect(nextUp.tasks.map((t: { id: string }) => t.id)).toEqual(['m00-demo/t02-code']);
      expect(nextUp.pendingCards).toBe(1);
    });

    it('records active time and never lets it go down', async () => {
      const started = await ctx
        .http()
        .post('/api/sessions')
        .send({ activity: 'lesson', itemId: 'm00-demo/l01-first' })
        .expect(201);
      const id = started.body.id;
      // A report longer than the session has existed is cut down to its age.
      await ctx.http().patch(`/api/sessions/${id}`).send({ activeSeconds: 86_400 }).expect(204);
      const db = ctx.app.get<Database>(DB);
      const [fresh] = await db
        .select({ activeSeconds: schema.studySessions.activeSeconds })
        .from(schema.studySessions)
        .where(eq(schema.studySessions.id, id));
      expect(fresh?.activeSeconds).toBeLessThan(60);

      // Pretend the session started two minutes ago.
      await db
        .update(schema.studySessions)
        .set({ startedAt: new Date(Date.now() - 120_000) })
        .where(eq(schema.studySessions.id, id));
      await ctx.http().patch(`/api/sessions/${id}`).send({ activeSeconds: 90 }).expect(204);
      await ctx.http().patch(`/api/sessions/${id}`).send({ activeSeconds: 30 }).expect(204);

      const stats = await ctx.http().get('/api/stats').expect(200);
      const { learning, memory } = stats.body;
      expect(learning.totalSeconds).toBe(90);
      expect(learning.secondsByDay).toHaveLength(30);
      expect(learning.secondsByDay.at(-1).seconds).toBe(90);
      expect(learning.secondsByModule).toEqual([
        { moduleId: 'm00-demo', title: 'Demo module', seconds: 90 },
      ]);
      expect(learning.studyStreakDays).toBe(1);
      expect(learning.tasksDone).toBe(1);
      // Two stored reviews of the same skill: 3 of 4 and 4 of 4.
      expect(learning.rubricBySkill).toEqual([
        { skillId: 'http-basics', title: 'HTTP basics', average: 0.875, reviews: 2 },
      ]);
      expect(memory.reviewStreakDays).toBe(1);
      expect(memory.desiredRetention).toBe(0.9);
      // Fourteen days, today first, and today's count is the "due today" number.
      expect(memory.dueByDay).toHaveLength(14);
      expect(memory.dueByDay[0].cards).toBe(memory.dueToday);
      const seen = await ctx.app
        .get<Database>(DB)
        .select({ due: schema.cardSchedules.due })
        .from(schema.cardSchedules)
        .innerJoin(schema.cards, eq(schema.cards.id, schema.cardSchedules.cardId))
        .where(and(eq(schema.cards.status, 'active'), ne(schema.cardSchedules.state, 'new')));
      const inWindow = seen.filter((r) => r.due.getTime() < Date.now() + 13 * 86_400_000).length;
      const forecast = (memory.dueByDay as { cards: number }[]).reduce((a, d) => a + d.cards, 0);
      expect(forecast).toBeGreaterThanOrEqual(inWindow);
      expect(forecast).toBeLessThanOrEqual(seen.length);
      const total = Object.values(memory.cardsByState as Record<string, number>).reduce(
        (a, b) => a + b,
        0,
      );
      expect(total).toBeGreaterThan(0);
    });

    it('keeps one note per lesson or task', async () => {
      const lessonId = 'm00-demo/l01-first';
      const empty = await ctx.http().get(`/api/notes/${lessonId}`).expect(200);
      expect(empty.body).toEqual({ body: '', updatedAt: null });

      const saved = await ctx
        .http()
        .put(`/api/notes/${lessonId}`)
        .send({ body: 'First' })
        .expect(200);
      expect(saved.body.body).toBe('First');
      await ctx.http().put(`/api/notes/${lessonId}`).send({ body: 'Second **draft**' }).expect(200);
      const read = await ctx.http().get(`/api/notes/${lessonId}`).expect(200);
      expect(read.body.body).toBe('Second **draft**');
      expect(read.body.updatedAt).toEqual(expect.any(String));

      // The list names what each note is about, in plan order.
      await ctx
        .http()
        .put('/api/notes/m00-demo/t01-explain')
        .send({ body: 'Task note' })
        .expect(200);
      const all = await ctx.http().get('/api/notes').expect(200);
      expect(
        all.body.notes.map((n: { itemId: string; kind: string }) => [n.kind, n.itemId]),
      ).toEqual([
        ['lesson', lessonId],
        ['task', 'm00-demo/t01-explain'],
      ]);
      expect(all.body.notes[0]).toMatchObject({
        moduleTitle: 'Demo module',
        body: 'Second **draft**',
      });
      await ctx.http().put('/api/notes/m00-demo/t01-explain').send({ body: '' }).expect(200);

      // Search finds a note by its own words, and ranks it above the page it is on.
      const found = await ctx.http().get('/api/search?q=draft').expect(200);
      expect(found.body.results).toEqual([
        {
          kind: 'lesson',
          id: lessonId,
          title: 'First lesson',
          moduleTitle: 'Demo module',
          snippet: 'Second draft',
          inNote: true,
        },
      ]);
      // The note comes before a page that has the word in its title.
      const titled = await ctx.http().get('/api/search?q=second').expect(200);
      expect(
        titled.body.results.map((r: { id: string; inNote: boolean }) => [r.id, r.inNote]),
      ).toEqual([
        [lessonId, true],
        ['m00-demo/l02-second', false],
      ]);
      const both = await ctx.http().get('/api/search?q=first').expect(200);
      expect(both.body.results.map((r: { inNote: boolean }) => r.inNote)).toEqual([false]);

      // An emptied note is removed, not stored as blank text.
      await ctx.http().put(`/api/notes/${lessonId}`).send({ body: '   ' }).expect(200);
      const gone = await ctx.http().get(`/api/notes/${lessonId}`).expect(200);
      expect(gone.body).toEqual({ body: '', updatedAt: null });

      await ctx.http().get('/api/notes/m00-demo/l99-missing').expect(404);
      await ctx.http().put('/api/notes/m00-demo/l99-missing').send({ body: 'x' }).expect(404);
      await ctx
        .http()
        .put(`/api/notes/${lessonId}`)
        .send({ body: 'x'.repeat(20_001) })
        .expect(400);
      await ctx.http().put(`/api/notes/${lessonId}`).send({}).expect(400);
    });

    it('offers the page opened last, while it is unfinished', async () => {
      // The session test above opened the first lesson, which is done by now.
      const before = await ctx.http().get('/api/plan').expect(200);
      expect(before.body.nextUp.continueWith).toBeNull();

      await ctx
        .http()
        .post('/api/sessions')
        .send({ activity: 'task', itemId: 'm00-demo/t02-code' })
        .expect(201);
      const after = await ctx.http().get('/api/plan').expect(200);
      expect(after.body.nextUp.continueWith).toEqual({
        kind: 'task',
        id: 'm00-demo/t02-code',
        title: expect.any(String),
        moduleTitle: 'Demo module',
      });
    });

    it('rejects a heartbeat for an unknown session', async () => {
      const res = await ctx
        .http()
        .patch('/api/sessions/00000000-0000-4000-8000-000000000000')
        .send({ activeSeconds: 5 });
      expect(res.status).toBe(404);
    });
  });
}
