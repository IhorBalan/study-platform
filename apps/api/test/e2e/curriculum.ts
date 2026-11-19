import { describe, expect, it } from 'vitest';
import type { E2eContext } from './context.js';

export function curriculumTests(ctx: E2eContext): void {
  describe('curriculum', () => {
    it('lists modules with their lessons and tasks in order', async () => {
      const res = await ctx.http().get('/api/plan').expect(200);
      expect(res.body.modules).toHaveLength(1);
      expect(res.body.modules[0]).toMatchObject({
        id: 'm00-demo',
        kind: 'core',
        effort: 'S',
        lessons: [
          { id: 'm00-demo/l01-first', status: 'not_started' },
          { id: 'm00-demo/l02-second', status: 'not_started' },
        ],
        tasks: [
          { id: 'm00-demo/t01-explain', type: 'text', status: 'not_started' },
          { id: 'm00-demo/t02-code', type: 'repo', status: 'not_started' },
        ],
      });
    });

    it('serves a lesson with previous and next links', async () => {
      const res = await ctx.http().get('/api/lessons/m00-demo/l01-first').expect(200);
      expect(res.body).toMatchObject({
        title: 'First lesson',
        markdown: 'Hello **world**.',
        cardCount: 2,
        previous: null,
        next: { id: 'm00-demo/l02-second', title: 'Second lesson' },
      });
    });

    it('returns 404 for a lesson that does not exist', async () => {
      const res = await ctx.http().get('/api/lessons/m00-demo/l99-missing').expect(404);
      expect(res.body.detail).toContain('does not exist');
    });

    it('rejects an invalid progress body with 400', async () => {
      const res = await ctx
        .http()
        .put('/api/lessons/m00-demo/l01-first/progress')
        .send({ status: 'finished' })
        .expect(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body.errors[0].path).toBe('status');
    });

    it('adds the lesson deck once when a lesson is completed', async () => {
      const first = await ctx
        .http()
        .put('/api/lessons/m00-demo/l01-first/progress')
        .send({ status: 'done' })
        .expect(200);
      expect(first.body).toEqual({ status: 'done', cardsAdded: 2 });

      const again = await ctx
        .http()
        .put('/api/lessons/m00-demo/l01-first/progress')
        .send({ status: 'done' })
        .expect(200);
      expect(again.body).toEqual({ status: 'done', cardsAdded: 0 });

      const plan = await ctx.http().get('/api/plan').expect(200);
      expect(plan.body.modules[0].lessons[0].status).toBe('done');
    });

    it('serves a task brief with its rubric', async () => {
      const res = await ctx.http().get('/api/tasks/m00-demo/t01-explain').expect(200);
      expect(res.body).toMatchObject({
        type: 'text',
        markdown: 'Explain HTTP caching.',
        labFolder: 'm00-demo/t01-explain',
        rubric: [{ id: 'clarity', max: 4 }],
      });
    });

    it('finds lessons and tasks by words in the title or the text', async () => {
      const byText = await ctx.http().get('/api/search?q=WORLD').expect(200);
      expect(byText.body.results).toEqual([
        {
          kind: 'lesson',
          id: 'm00-demo/l01-first',
          title: 'First lesson',
          moduleTitle: expect.any(String),
          snippet: 'Hello world.',
          inNote: false,
        },
      ]);

      const byTitle = await ctx.http().get('/api/search?q=lesson%20second').expect(200);
      expect(byTitle.body.results.map((r: { id: string }) => r.id)).toEqual([
        'm00-demo/l02-second',
      ]);

      const task = await ctx.http().get('/api/search?q=caching').expect(200);
      expect(task.body.results).toMatchObject([{ kind: 'task', id: 'm00-demo/t01-explain' }]);
    });

    it('returns no results for an empty search, one-letter words or no match', async () => {
      for (const q of ['', 'e', 'e%20o', 'kubernetes']) {
        const res = await ctx.http().get(`/api/search?q=${q}`).expect(200);
        expect(res.body.results).toEqual([]);
      }
      await ctx
        .http()
        .get(`/api/search?q=${'x'.repeat(101)}`)
        .expect(400);
    });
  });
}
