import { schema } from '@study/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { DB, type Database } from '../../src/database/database.module.js';
import { QueueService } from '../../src/queue/queue.service.js';
import type { E2eContext } from './context.js';

export function submissionsTests(ctx: E2eContext): void {
  describe('submissions', () => {
    it('stores a written answer without a check run', async () => {
      const res = await ctx
        .http()
        .post('/api/tasks/m00-demo/t01-explain/submissions')
        .send({ type: 'text', body: 'Because of caching.' })
        .expect(201);
      expect(res.body).toMatchObject({
        type: 'text',
        body: 'Because of caching.',
        runs: [],
        review: null,
      });

      // A saved answer is work in progress until a review is stored.
      const plan = await ctx.http().get('/api/plan').expect(200);
      const task = plan.body.modules[0].tasks.find(
        (t: { id: string }) => t.id === 'm00-demo/t01-explain',
      );
      expect(task.status).toBe('in_progress');
    });

    it('queues automated checks for a code submission', async () => {
      const res = await ctx
        .http()
        .post('/api/tasks/m00-demo/t02-code/submissions')
        .send({ type: 'repo', commitSha: 'abc1234' })
        .expect(201);
      expect(res.body).toMatchObject({
        type: 'repo',
        commitSha: 'abc1234',
        runs: [{ stage: 'checks', status: 'queued', checks: [] }],
      });

      const list = await ctx.http().get('/api/tasks/m00-demo/t02-code/submissions').expect(200);
      expect(list.body.submissions).toHaveLength(1);
    });

    it('pins "latest commit" to the commit that is latest when the answer is submitted', async () => {
      const pinned = 'f'.repeat(40);
      await ctx.http().patch('/api/settings').send({ labRepoPath: '/tmp/lab' }).expect(200);
      ctx.resolvedCommit = pinned;
      try {
        const latest = await ctx
          .http()
          .post('/api/tasks/m00-demo/t02-code/submissions')
          .send({ type: 'repo' })
          .expect(201);
        expect(latest.body.commitSha).toBe(pinned);
        expect(ctx.commitLookups.at(-1)).toEqual({ repoPath: '/tmp/lab' });

        // A short id is stored in full as well.
        const short = await ctx
          .http()
          .post('/api/tasks/m00-demo/t02-code/submissions')
          .send({ type: 'repo', commitSha: 'fffffff' })
          .expect(201);
        expect(short.body.commitSha).toBe(pinned);
        expect(ctx.commitLookups.at(-1)).toEqual({ repoPath: '/tmp/lab', commitSha: 'fffffff' });

        // A commit the repository does not have stays as typed; the check run reports it.
        ctx.resolvedCommit = null;
        const unknown = await ctx
          .http()
          .post('/api/tasks/m00-demo/t02-code/submissions')
          .send({ type: 'repo', commitSha: 'deadbeef' })
          .expect(201);
        expect(unknown.body.commitSha).toBe('deadbeef');

        const db = ctx.app.get<Database>(DB);
        for (const made of [latest, short, unknown]) {
          await db.delete(schema.submissions).where(eq(schema.submissions.id, made.body.id));
        }
      } finally {
        ctx.resolvedCommit = undefined;
        await ctx.http().patch('/api/settings').send({ labRepoPath: null }).expect(200);
      }
    });

    it('marks a run as stalled when it keeps waiting and nothing else is running', async () => {
      const db = ctx.app.get<Database>(DB);
      const first = await ctx
        .http()
        .post('/api/tasks/m00-demo/t02-code/submissions')
        .send({ type: 'repo', commitSha: 'abc1234' })
        .expect(201);
      const second = await ctx
        .http()
        .post('/api/tasks/m00-demo/t02-code/submissions')
        .send({ type: 'repo', commitSha: 'abc1234' })
        .expect(201);
      const runOf = async (id: string) => {
        const list = await ctx.http().get('/api/tasks/m00-demo/t02-code/submissions').expect(200);
        return list.body.submissions.find((s: { id: string }) => s.id === id).runs[0];
      };
      try {
        expect(first.body.runs[0].stalled).toBe(false);

        // Half a minute later nothing has taken it: no checker is running.
        await db
          .update(schema.verificationRuns)
          .set({ createdAt: new Date(Date.now() - 30_000) })
          .where(eq(schema.verificationRuns.id, first.body.runs[0].id));
        expect((await runOf(first.body.id)).stalled).toBe(true);

        // Behind a run that is in progress, waiting is normal.
        await db
          .update(schema.verificationRuns)
          .set({ status: 'running' })
          .where(eq(schema.verificationRuns.id, second.body.runs[0].id));
        expect((await runOf(first.body.id)).stalled).toBe(false);
      } finally {
        for (const made of [first, second]) {
          await db.delete(schema.submissions).where(eq(schema.submissions.id, made.body.id));
        }
      }
    });

    it('reports a run whose checks could not be queued, so it does not wait for ever', async () => {
      const enqueue = vi
        .spyOn(ctx.app.get(QueueService), 'enqueueChecks')
        .mockRejectedValueOnce(new Error('queue is down'));
      const res = await ctx
        .http()
        .post('/api/tasks/m00-demo/t02-code/submissions')
        .send({ type: 'repo' })
        .expect(201);
      enqueue.mockRestore();
      expect(res.body.runs).toHaveLength(1);
      expect(res.body.runs[0]).toMatchObject({
        status: 'error',
        error: 'The checks could not be queued. Submit again.',
      });
    });

    it('accepts an answer at the schema maximum in a non-Latin script', async () => {
      // 50,000 Cyrillic letters are about 100 kB of JSON, more than the framework's default limit.
      const body = 'я'.repeat(50_000);
      const res = await ctx
        .http()
        .post('/api/tasks/m00-demo/t01-explain/submissions')
        .send({ type: 'text', body })
        .expect(201);
      expect(res.body.body).toHaveLength(50_000);
      await ctx.app
        .get<Database>(DB)
        .delete(schema.submissions)
        .where(eq(schema.submissions.id, res.body.id));

      const tooLarge = await ctx
        .http()
        .post('/api/tasks/m00-demo/t01-explain/submissions')
        .send({ type: 'text', body: 'x'.repeat(1_100_000) });
      expect(tooLarge.status).toBe(413);
    });

    it('rejects the wrong kind of submission for a task', async () => {
      const res = await ctx
        .http()
        .post('/api/tasks/m00-demo/t01-explain/submissions')
        .send({ type: 'repo' });
      expect(res.status).toBe(400);
    });

    it('rejects a commit id that is not hexadecimal', async () => {
      const res = await ctx
        .http()
        .post('/api/tasks/m00-demo/t02-code/submissions')
        .send({ type: 'repo', commitSha: 'HEAD; rm -rf /' });
      expect(res.status).toBe(400);
    });

    it('answers 404 for an unknown task', async () => {
      const res = await ctx.http().get('/api/tasks/m00-demo/t99-none/submissions');
      expect(res.status).toBe(404);
    });

    describe('Claude review by copy and paste', () => {
      let submissionId: string;
      let runId: string;
      const reply = {
        scores: [{ rubricId: 'clarity', score: 3, comment: 'Clear, but misses revalidation.' }],
        strengths: ['Names the cache layers.'],
        issues: [{ severity: 'medium', message: 'ETag is not mentioned.', file: null, line: null }],
        securityConcerns: [],
        nextStep: 'Read about conditional requests.',
        suggestedCards: [
          { type: 'concept', front: 'What does ETag do?', back: 'It names a version.' },
        ],
      };

      it('builds a prompt with the task, the rubric and the answer', async () => {
        const created = await ctx
          .http()
          .post('/api/tasks/m00-demo/t01-explain/submissions')
          .send({ type: 'text', body: 'Caches store responses.' })
          .expect(201);
        submissionId = created.body.id;
        const res = await ctx
          .http()
          .post(`/api/submissions/${submissionId}/reviews`)
          .send({})
          .expect(201);
        runId = res.body.runId;
        expect(res.body).toMatchObject({ status: 'queued', mode: 'copy_paste', result: null });
        expect(res.body.prompt).toContain('Explain it');
        expect(res.body.prompt).toContain('id "clarity", 0 to 4 points');
        expect(res.body.prompt).toContain('Caches store responses.');
      });

      it('explains what is wrong with a reply that is not JSON', async () => {
        const res = await ctx
          .http()
          .post(`/api/reviews/${runId}/result`)
          .send({ raw: 'Looks good!' });
        expect(res.status).toBe(422);
        expect(res.body.errors[0].message).toContain('No JSON object');
      });

      it('rejects a score above the rubric maximum and an unknown rubric item', async () => {
        const bad = {
          ...reply,
          scores: [
            { rubricId: 'clarity', score: 9, comment: 'x' },
            { rubricId: 'style', score: 1, comment: 'x' },
          ],
        };
        const res = await ctx
          .http()
          .post(`/api/reviews/${runId}/result`)
          .send({ raw: JSON.stringify(bad) });
        expect(res.status).toBe(422);
        const messages = res.body.errors.map((e: { message: string }) => e.message).join(' ');
        expect(messages).toContain('maximum is 4');
        expect(messages).toContain('"style" is not a rubric item');
      });

      it('accepts a valid reply wrapped in a code fence and stores scores and cards', async () => {
        const raw = 'Here you go:\n```json\n' + JSON.stringify(reply, null, 2) + '\n```';
        const res = await ctx.http().post(`/api/reviews/${runId}/result`).send({ raw }).expect(200);
        expect(res.body).toMatchObject({
          status: 'passed',
          cardsSuggested: 1,
          scores: [{ rubricId: 'clarity', score: 3, max: 4 }],
        });
        expect(res.body.result.nextStep).toBe('Read about conditional requests.');

        const pending = await ctx.http().get('/api/cards?status=pending').expect(200);
        expect(pending.body.cards).toHaveLength(1);
        expect(pending.body.cards[0]).toMatchObject({
          source: 'claude',
          front: 'What does ETag do?',
        });

        const list = await ctx
          .http()
          .get('/api/tasks/m00-demo/t01-explain/submissions')
          .expect(200);
        const mine = list.body.submissions.find((s: { id: string }) => s.id === submissionId);
        expect(mine.review).toMatchObject({ runId, status: 'passed' });
      });

      it('does not accept a second result for the same review', async () => {
        const res = await ctx
          .http()
          .post(`/api/reviews/${runId}/result`)
          .send({ raw: JSON.stringify(reply) });
        expect(res.status).toBe(409);
      });

      it('stores one result when the same reply arrives twice at once', async () => {
        const started = await ctx
          .http()
          .post(`/api/submissions/${submissionId}/reviews`)
          .send({})
          .expect(201);
        const second = started.body.runId as string;
        const raw = JSON.stringify(reply);
        const answers = await Promise.all([
          ctx.http().post(`/api/reviews/${second}/result`).send({ raw }),
          ctx.http().post(`/api/reviews/${second}/result`).send({ raw }),
        ]);
        expect(answers.map((r) => r.status).toSorted()).toEqual([200, 409]);

        const db = ctx.app.get<Database>(DB);
        const scores = await db
          .select()
          .from(schema.rubricScores)
          .where(eq(schema.rubricScores.runId, second));
        expect(scores).toHaveLength(1);
        const suggested = await db
          .select()
          .from(schema.cards)
          .where(eq(schema.cards.suggestedByRunId, second));
        expect(suggested).toHaveLength(1);

        // Remove this extra review so the later tests see only the first one.
        await db.delete(schema.cards).where(eq(schema.cards.suggestedByRunId, second));
        await db.delete(schema.verificationRuns).where(eq(schema.verificationRuns.id, second));
      });

      it('keeps suggested cards out of the review queue until approved', async () => {
        const queue = await ctx.http().get('/api/review/queue').expect(200);
        expect(queue.body.counts.pendingApproval).toBe(1);
        expect(
          queue.body.cards.some((c: { front: string }) => c.front === 'What does ETag do?'),
        ).toBe(false);
      });
    });

    describe('Claude review in one click', () => {
      const ok = (output: string) => ({
        status: 'ok',
        message: null,
        output,
        model: 'claude-test',
        costUsd: null,
        durationMs: 5,
      });
      const valid = JSON.stringify({
        scores: [{ rubricId: 'clarity', score: 4, comment: 'Clear.' }],
        strengths: [],
        issues: [],
        securityConcerns: [],
        nextStep: 'Move on.',
        suggestedCards: [],
      });

      async function reviewAndWait(): Promise<{ status: string; error: string | null }> {
        const created = await ctx
          .http()
          .post('/api/tasks/m00-demo/t01-explain/submissions')
          .send({ type: 'text', body: 'An answer.' })
          .expect(201);
        const started = await ctx
          .http()
          .post(`/api/submissions/${created.body.id}/reviews`)
          .send({ mode: 'bridge' })
          .expect(201);
        expect(started.body).toMatchObject({ mode: 'bridge' });
        for (let i = 0; i < 50; i += 1) {
          const res = await ctx.http().get(`/api/reviews/${started.body.runId}`).expect(200);
          if (res.body.status !== 'running') return res.body;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('the review never finished');
      }

      it('retries once when the first reply is unusable, then stores the result', async () => {
        ctx.bridgeReplies.push(ok('I think it is fine.'), ok(valid));
        const review = await reviewAndWait();
        expect(review).toMatchObject({ status: 'passed', error: null });
        expect(ctx.bridgeReplies).toHaveLength(0);
      });

      it('gives up after two unusable replies and says what to do', async () => {
        ctx.bridgeReplies.push(ok('nope'), ok('still nope'));
        const review = await reviewAndWait();
        expect(review.status).toBe('error');
        expect(review.error).toContain('copy and paste');
      });

      it('starts only one review when asked several times at once', async () => {
        const created = await ctx
          .http()
          .post('/api/tasks/m00-demo/t01-explain/submissions')
          .send({ type: 'text', body: 'An answer.' })
          .expect(201);
        const start = () =>
          ctx.http().post(`/api/submissions/${created.body.id}/reviews`).send({ mode: 'bridge' });
        ctx.bridgeDelayMs = 1000;
        try {
          const replies = await Promise.all([start(), start(), start()]);
          expect(replies.map((r) => r.status).toSorted()).toEqual([201, 409, 409]);
        } finally {
          ctx.bridgeDelayMs = 0;
        }
      });

      it('does not blame the bridge for a reply the platform cannot read', async () => {
        ctx.bridgeReplies.push({ unexpected: 'shape' });
        const review = await reviewAndWait();
        expect(review.status).toBe('error');
        expect(review.error).toContain('error in the platform');
        expect(review.error).not.toContain('could not be reached');
      });

      it('passes on the reason when the CLI is not signed in', async () => {
        ctx.bridgeReplies.push({
          status: 'error',
          message: 'Claude could not complete the review: Not logged in.',
          output: '',
          model: null,
          costUsd: null,
          durationMs: 3,
        });
        const review = await reviewAndWait();
        expect(review).toMatchObject({ status: 'error' });
        expect(review.error).toContain('Not logged in');
      });
    });

    it('reports the bridge as unreachable when it is not running', async () => {
      const res = await ctx.http().get('/api/bridge').expect(200);
      expect(res.body).toEqual({
        reachable: false,
        docker: false,
        runners: [],
        claude: false,
        lastBackupAt: null,
      });
    });
  });
}
