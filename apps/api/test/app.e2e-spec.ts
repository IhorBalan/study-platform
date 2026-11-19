import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { schema } from '@study/db';
import { and, eq, ne } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DeckSyncService } from '../src/curriculum/deck-sync.service.js';
import { JSON_BODY_LIMIT } from '../src/common/body-limit.js';
import { QueueService } from '../src/queue/queue.service.js';
import { WeakSkillsService } from '../src/srs/weak-skills.service.js';
import { DB, type Database } from '../src/database/database.module.js';

describe('API (e2e, real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let app: NestExpressApplication;
  let bridge: Server;
  const bridgeReplies: unknown[] = [];
  /** How long the stand-in bridge takes to answer, to imitate a review in progress. */
  let bridgeDelayMs = 0;
  const http = () => request(app.getHttpServer());
  /** Moves a card's due date into the past, as if its interval had elapsed. */
  const makeDue = async (cardId: string) => {
    await app
      .get<Database>(DB)
      .update(schema.cardSchedules)
      .set({ due: new Date(Date.now() - 60_000) })
      .where(eq(schema.cardSchedules.cardId, cardId));
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine').start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.CURRICULUM_DIR = path.join(import.meta.dirname, 'fixtures/curriculum');
    // A stand-in bridge: it has no health route (so it counts as offline for
    // checks) and answers review requests with whatever a test queued.
    bridge = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/review/run') {
        req.resume();
        req.on('end', () => {
          setTimeout(() => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify(
                bridgeReplies.shift() ?? {
                  status: 'error',
                  message: 'no reply queued',
                  output: '',
                  model: null,
                  costUsd: null,
                  durationMs: 1,
                },
              ),
            );
          }, bridgeDelayMs);
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => bridge.listen(0, '127.0.0.1', resolve));
    process.env.BRIDGE_URL = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
    process.env.BRIDGE_SECRET = 'test-secret-that-is-long-enough-123';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await container?.stop();
    bridge?.close();
  });

  it('reports a healthy database', async () => {
    const res = await http().get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('returns RFC 9457 problem details for unknown routes', async () => {
    const res = await http().get('/api/nope').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, title: 'Not found' });
  });

  describe('write protection', () => {
    it('refuses writes from another origin and form-encoded bodies', async () => {
      const foreign = await http()
        .post('/api/cards')
        .set('Origin', 'https://evil.example')
        .send({ type: 'term', front: 'planted', back: 'x', skills: [] });
      expect(foreign.status).toBe(403);
      expect(foreign.headers['content-type']).toContain('application/problem+json');

      const form = await http()
        .post('/api/cards')
        .type('form')
        .send('type=term&front=planted&back=x');
      expect(form.status).toBe(415);

      const list = await http().get('/api/cards').expect(200);
      expect(list.body.cards.some((c: { front: string }) => c.front === 'planted')).toBe(false);
    });

    it('answers only requests addressed to this machine', async () => {
      // A page on a domain re-pointed at 127.0.0.1 would send its own name as Host.
      const res = await http().get('/api/settings').set('Host', 'evil.example:3000').expect(403);
      expect(res.headers['content-type']).toContain('application/problem+json');
      for (const host of ['localhost:3000', '127.0.0.1:3000', 'localhost', '[::1]:3000']) {
        await http().get('/api/health').set('Host', host).expect(200);
      }
    });

    it('accepts JSON writes from the web app on localhost and 127.0.0.1', async () => {
      for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
        const res = await http().patch('/api/settings').set('Origin', origin).send({});
        expect(res.status).toBe(200);
      }
    });
  });

  describe('curriculum', () => {
    it('lists modules with their lessons and tasks in order', async () => {
      const res = await http().get('/api/plan').expect(200);
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
      const res = await http().get('/api/lessons/m00-demo/l01-first').expect(200);
      expect(res.body).toMatchObject({
        title: 'First lesson',
        markdown: 'Hello **world**.',
        cardCount: 2,
        previous: null,
        next: { id: 'm00-demo/l02-second', title: 'Second lesson' },
      });
    });

    it('returns 404 for a lesson that does not exist', async () => {
      const res = await http().get('/api/lessons/m00-demo/l99-missing').expect(404);
      expect(res.body.detail).toContain('does not exist');
    });

    it('rejects an invalid progress body with 400', async () => {
      const res = await http()
        .put('/api/lessons/m00-demo/l01-first/progress')
        .send({ status: 'finished' })
        .expect(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body.errors[0].path).toBe('status');
    });

    it('adds the lesson deck once when a lesson is completed', async () => {
      const first = await http()
        .put('/api/lessons/m00-demo/l01-first/progress')
        .send({ status: 'done' })
        .expect(200);
      expect(first.body).toEqual({ status: 'done', cardsAdded: 2 });

      const again = await http()
        .put('/api/lessons/m00-demo/l01-first/progress')
        .send({ status: 'done' })
        .expect(200);
      expect(again.body).toEqual({ status: 'done', cardsAdded: 0 });

      const plan = await http().get('/api/plan').expect(200);
      expect(plan.body.modules[0].lessons[0].status).toBe('done');
    });

    it('serves a task brief with its rubric', async () => {
      const res = await http().get('/api/tasks/m00-demo/t01-explain').expect(200);
      expect(res.body).toMatchObject({
        type: 'text',
        markdown: 'Explain HTTP caching.',
        labFolder: 'm00-demo/t01-explain',
        rubric: [{ id: 'clarity', max: 4 }],
      });
    });

    it('finds lessons and tasks by words in the title or the text', async () => {
      const byText = await http().get('/api/search?q=WORLD').expect(200);
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

      const byTitle = await http().get('/api/search?q=lesson%20second').expect(200);
      expect(byTitle.body.results.map((r: { id: string }) => r.id)).toEqual([
        'm00-demo/l02-second',
      ]);

      const task = await http().get('/api/search?q=caching').expect(200);
      expect(task.body.results).toMatchObject([{ kind: 'task', id: 'm00-demo/t01-explain' }]);
    });

    it('returns no results for an empty search, one-letter words or no match', async () => {
      for (const q of ['', 'e', 'e%20o', 'kubernetes']) {
        const res = await http().get(`/api/search?q=${q}`).expect(200);
        expect(res.body.results).toEqual([]);
      }
      await http()
        .get(`/api/search?q=${'x'.repeat(101)}`)
        .expect(400);
    });
  });
  describe('submissions', () => {
    it('stores a written answer without a check run', async () => {
      const res = await http()
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
      const plan = await http().get('/api/plan').expect(200);
      const task = plan.body.modules[0].tasks.find(
        (t: { id: string }) => t.id === 'm00-demo/t01-explain',
      );
      expect(task.status).toBe('in_progress');
    });

    it('queues automated checks for a code submission', async () => {
      const res = await http()
        .post('/api/tasks/m00-demo/t02-code/submissions')
        .send({ type: 'repo', commitSha: 'abc1234' })
        .expect(201);
      expect(res.body).toMatchObject({
        type: 'repo',
        commitSha: 'abc1234',
        runs: [{ stage: 'checks', status: 'queued', checks: [] }],
      });

      const list = await http().get('/api/tasks/m00-demo/t02-code/submissions').expect(200);
      expect(list.body.submissions).toHaveLength(1);
    });

    it('reports a run whose checks could not be queued, so it does not wait for ever', async () => {
      const enqueue = vi
        .spyOn(app.get(QueueService), 'enqueueChecks')
        .mockRejectedValueOnce(new Error('queue is down'));
      const res = await http()
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
      const res = await http()
        .post('/api/tasks/m00-demo/t01-explain/submissions')
        .send({ type: 'text', body })
        .expect(201);
      expect(res.body.body).toHaveLength(50_000);
      await app
        .get<Database>(DB)
        .delete(schema.submissions)
        .where(eq(schema.submissions.id, res.body.id));

      const tooLarge = await http()
        .post('/api/tasks/m00-demo/t01-explain/submissions')
        .send({ type: 'text', body: 'x'.repeat(1_100_000) });
      expect(tooLarge.status).toBe(413);
    });

    it('rejects the wrong kind of submission for a task', async () => {
      const res = await http()
        .post('/api/tasks/m00-demo/t01-explain/submissions')
        .send({ type: 'repo' });
      expect(res.status).toBe(400);
    });

    it('rejects a commit id that is not hexadecimal', async () => {
      const res = await http()
        .post('/api/tasks/m00-demo/t02-code/submissions')
        .send({ type: 'repo', commitSha: 'HEAD; rm -rf /' });
      expect(res.status).toBe(400);
    });

    it('answers 404 for an unknown task', async () => {
      const res = await http().get('/api/tasks/m00-demo/t99-none/submissions');
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
        const created = await http()
          .post('/api/tasks/m00-demo/t01-explain/submissions')
          .send({ type: 'text', body: 'Caches store responses.' })
          .expect(201);
        submissionId = created.body.id;
        const res = await http()
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
        const res = await http().post(`/api/reviews/${runId}/result`).send({ raw: 'Looks good!' });
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
        const res = await http()
          .post(`/api/reviews/${runId}/result`)
          .send({ raw: JSON.stringify(bad) });
        expect(res.status).toBe(422);
        const messages = res.body.errors.map((e: { message: string }) => e.message).join(' ');
        expect(messages).toContain('maximum is 4');
        expect(messages).toContain('"style" is not a rubric item');
      });

      it('accepts a valid reply wrapped in a code fence and stores scores and cards', async () => {
        const raw = 'Here you go:\n```json\n' + JSON.stringify(reply, null, 2) + '\n```';
        const res = await http().post(`/api/reviews/${runId}/result`).send({ raw }).expect(200);
        expect(res.body).toMatchObject({
          status: 'passed',
          cardsSuggested: 1,
          scores: [{ rubricId: 'clarity', score: 3, max: 4 }],
        });
        expect(res.body.result.nextStep).toBe('Read about conditional requests.');

        const pending = await http().get('/api/cards?status=pending').expect(200);
        expect(pending.body.cards).toHaveLength(1);
        expect(pending.body.cards[0]).toMatchObject({
          source: 'claude',
          front: 'What does ETag do?',
        });

        const list = await http().get('/api/tasks/m00-demo/t01-explain/submissions').expect(200);
        const mine = list.body.submissions.find((s: { id: string }) => s.id === submissionId);
        expect(mine.review).toMatchObject({ runId, status: 'passed' });
      });

      it('does not accept a second result for the same review', async () => {
        const res = await http()
          .post(`/api/reviews/${runId}/result`)
          .send({ raw: JSON.stringify(reply) });
        expect(res.status).toBe(409);
      });

      it('stores one result when the same reply arrives twice at once', async () => {
        const started = await http()
          .post(`/api/submissions/${submissionId}/reviews`)
          .send({})
          .expect(201);
        const second = started.body.runId as string;
        const raw = JSON.stringify(reply);
        const answers = await Promise.all([
          http().post(`/api/reviews/${second}/result`).send({ raw }),
          http().post(`/api/reviews/${second}/result`).send({ raw }),
        ]);
        expect(answers.map((r) => r.status).toSorted()).toEqual([200, 409]);

        const db = app.get<Database>(DB);
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
        const queue = await http().get('/api/review/queue').expect(200);
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
        const created = await http()
          .post('/api/tasks/m00-demo/t01-explain/submissions')
          .send({ type: 'text', body: 'An answer.' })
          .expect(201);
        const started = await http()
          .post(`/api/submissions/${created.body.id}/reviews`)
          .send({ mode: 'bridge' })
          .expect(201);
        expect(started.body).toMatchObject({ mode: 'bridge' });
        for (let i = 0; i < 50; i += 1) {
          const res = await http().get(`/api/reviews/${started.body.runId}`).expect(200);
          if (res.body.status !== 'running') return res.body;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('the review never finished');
      }

      it('retries once when the first reply is unusable, then stores the result', async () => {
        bridgeReplies.push(ok('I think it is fine.'), ok(valid));
        const review = await reviewAndWait();
        expect(review).toMatchObject({ status: 'passed', error: null });
        expect(bridgeReplies).toHaveLength(0);
      });

      it('gives up after two unusable replies and says what to do', async () => {
        bridgeReplies.push(ok('nope'), ok('still nope'));
        const review = await reviewAndWait();
        expect(review.status).toBe('error');
        expect(review.error).toContain('copy and paste');
      });

      it('starts only one review when asked several times at once', async () => {
        const created = await http()
          .post('/api/tasks/m00-demo/t01-explain/submissions')
          .send({ type: 'text', body: 'An answer.' })
          .expect(201);
        const start = () =>
          http().post(`/api/submissions/${created.body.id}/reviews`).send({ mode: 'bridge' });
        bridgeDelayMs = 1000;
        try {
          const replies = await Promise.all([start(), start(), start()]);
          expect(replies.map((r) => r.status).toSorted()).toEqual([201, 409, 409]);
        } finally {
          bridgeDelayMs = 0;
        }
      });

      it('does not blame the bridge for a reply the platform cannot read', async () => {
        bridgeReplies.push({ unexpected: 'shape' });
        const review = await reviewAndWait();
        expect(review.status).toBe('error');
        expect(review.error).toContain('error in the platform');
        expect(review.error).not.toContain('could not be reached');
      });

      it('passes on the reason when the CLI is not signed in', async () => {
        bridgeReplies.push({
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
      const res = await http().get('/api/bridge').expect(200);
      expect(res.body).toEqual({
        reachable: false,
        docker: false,
        runners: [],
        claude: false,
        lastBackupAt: null,
      });
    });
  });

  describe('spaced repetition', () => {
    it('queues the lesson deck as new cards with a preview for each grade', async () => {
      const res = await http().get('/api/review/queue').expect(200);
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
      const res = await http()
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
      const all = await http().get('/api/review/queue').expect(200);
      const focused = await http().get('/api/review/queue?module=m00-demo').expect(200);
      const fronts = (body: { cards: { front: string }[] }) => body.cards.map((c) => c.front);
      expect(fronts(all.body)).toContain('Idempotency key');
      expect(fronts(focused.body)).toEqual(['Q1', expect.any(String)]);
      expect(focused.body.counts.newAvailable).toBe(all.body.counts.newAvailable - 1);
      await http().get('/api/review/queue?module=m99-missing').expect(404);
      await http().get('/api/review/queue?module=Not_An_Id').expect(400);
    });

    it('rejects a card that refers to an unknown skill', async () => {
      const res = await http()
        .post('/api/cards')
        .send({ type: 'term', front: 'x', back: 'y', skills: ['nope'] })
        .expect(400);
      expect(res.body.detail).toContain('Unknown skill');
    });

    it('reschedules a card into the future when it is graded good', async () => {
      const queue = await http().get('/api/review/queue').expect(200);
      const card = queue.body.cards[0];

      const res = await http()
        .post(`/api/review/${card.id}`)
        .send({ grade: 'good', answerMs: 4200 })
        .expect(200);
      expect(res.body.state).not.toBe('new');
      expect(new Date(res.body.due).getTime()).toBeGreaterThan(Date.now());
      // The preview promised the same due date, to the second.
      expect(
        Math.abs(new Date(res.body.due).getTime() - new Date(card.preview.good).getTime()),
      ).toBeLessThan(5000);

      const after = await http().get('/api/review/queue').expect(200);
      expect(after.body.cards.map((c: { id: string }) => c.id)).not.toContain(card.id);
      expect(after.body.counts.reviewedToday).toBe(1);
      // The card just graded is the only one scheduled, so it is the next one due.
      expect(after.body.nextDue).toBe(res.body.due);
      // Too few timed reviews to measure a pace, so the default stands.
      expect(after.body.secondsPerCard).toBe(8);
    });

    it('survives a second review of the same card (stored state round-trips)', async () => {
      const list = await http().get('/api/cards').expect(200);
      const reviewed = list.body.cards.find((c: { reps: number }) => c.reps === 1);

      // Not due yet: a repeated or concurrent grade is refused and changes nothing.
      const early = await http().post(`/api/review/${reviewed.id}`).send({ grade: 'again' });
      expect(early.status).toBe(409);

      await makeDue(reviewed.id);
      const [first, second] = await Promise.all([
        http().post(`/api/review/${reviewed.id}`).send({ grade: 'good' }),
        http().post(`/api/review/${reviewed.id}`).send({ grade: 'again' }),
      ]);
      expect([first.status, second.status].toSorted()).toEqual([200, 409]);

      // The grade is saved before the weak-skill list is updated. If that update
      // fails, the grade still counts and the request still succeeds.
      await makeDue(reviewed.id);
      const evaluate = vi
        .spyOn(app.get(WeakSkillsService), 'evaluate')
        .mockRejectedValueOnce(new Error('evaluation failed'));
      const res = await http()
        .post(`/api/review/${reviewed.id}`)
        .send({ grade: 'again' })
        .expect(200);
      expect(evaluate).toHaveBeenCalledOnce();
      evaluate.mockRestore();
      expect(['learning', 'relearning', 'review']).toContain(res.body.state);
      const again = await http().get('/api/cards').expect(200);
      expect(again.body.cards.find((c: { id: string }) => c.id === reviewed.id).reps).toBe(3);
    });

    it('undoes the latest grade and restores the schedule exactly', async () => {
      const list = await http().get('/api/cards').expect(200);
      const target = list.body.cards.find((c: { reps: number }) => c.reps === 3);
      await makeDue(target.id);
      const before = (await http().get('/api/cards').expect(200)).body.cards.find(
        (c: { id: string }) => c.id === target.id,
      );
      const reviewedBefore = (await http().get('/api/review/queue').expect(200)).body.counts
        .reviewedToday;

      await http().post(`/api/review/${target.id}`).send({ grade: 'easy' }).expect(200);
      const undone = await http().post(`/api/review/${target.id}/undo`).expect(200);
      expect(undone.body.due).toBe(before.due);

      const after = (await http().get('/api/cards').expect(200)).body.cards.find(
        (c: { id: string }) => c.id === target.id,
      );
      expect(after).toEqual(before);
      const queue = await http().get('/api/review/queue').expect(200);
      expect(queue.body.counts.reviewedToday).toBe(reviewedBefore);

      // A new grade can be undone again.
      await http().post(`/api/review/${target.id}`).send({ grade: 'good' }).expect(200);
      await http().post(`/api/review/${target.id}/undo`).expect(200);

      await http().post('/api/review/00000000-0000-4000-8000-000000000000/undo').expect(404);
    });

    it('refuses to undo a grade that is more than ten minutes old', async () => {
      const list = await http().get('/api/cards').expect(200);
      const target = list.body.cards.find((c: { reps: number }) => c.reps === 3);
      await makeDue(target.id);
      await http().post(`/api/review/${target.id}`).send({ grade: 'good' }).expect(200);
      await app
        .get<Database>(DB)
        .update(schema.reviews)
        .set({ reviewedAt: new Date(Date.now() - 11 * 60_000) })
        .where(eq(schema.reviews.cardId, target.id));
      const res = await http().post(`/api/review/${target.id}/undo`);
      expect(res.status).toBe(409);
      expect(res.body.detail ?? res.body.message).toMatch(/10 minutes/);
    });

    it('allows one open refresh per skill', async () => {
      const db = app.get<Database>(DB);
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
      await http().patch('/api/settings').send({ newCardsPerDay: 1 }).expect(200);
      const res = await http().get('/api/review/queue').expect(200);
      // One new card was already introduced today, so none are left.
      expect(res.body.counts.newAvailable).toBe(0);
      expect(res.body.cards.every((c: { state: string }) => c.state !== 'new')).toBe(true);
      await http().patch('/api/settings').send({ newCardsPerDay: 10 }).expect(200);
    });

    it('does not let a suspended card be reviewed', async () => {
      const list = await http().get('/api/cards?status=active').expect(200);
      const target = list.body.cards.find((c: { state: string }) => c.state === 'new');
      await http().patch(`/api/cards/${target.id}`).send({ status: 'suspended' }).expect(200);
      const res = await http().post(`/api/review/${target.id}`).send({ grade: 'good' });
      expect(res.status).toBe(409);
    });

    it('does not let a card be moved back to waiting for approval', async () => {
      const list = await http().get('/api/cards?status=active').expect(200);
      const target = list.body.cards[0];
      const res = await http().patch(`/api/cards/${target.id}`).send({ status: 'pending' });
      expect(res.status).toBe(400);
    });

    it('validates settings', async () => {
      const res = await http().patch('/api/settings').send({ desiredRetention: 1.5 });
      expect(res.status).toBe(400);
      for (const body of [
        { reviewMode: 'api' },
        { labRepoPath: '' },
        { labRepoPath: 'some/dir' },
      ]) {
        const bad = await http().patch('/api/settings').send(body);
        expect(bad.status).toBe(400);
      }
      await http().patch('/api/settings').send({ labRepoPath: '/tmp/lab' }).expect(200);
      await http().patch('/api/settings').send({ labRepoPath: null }).expect(200);
    });
  });

  describe('plan, time and statistics', () => {
    it('points to the next lesson and lists open tasks', async () => {
      const res = await http().get('/api/plan').expect(200);
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
      const started = await http()
        .post('/api/sessions')
        .send({ activity: 'lesson', itemId: 'm00-demo/l01-first' })
        .expect(201);
      const id = started.body.id;
      // A report longer than the session has existed is cut down to its age.
      await http().patch(`/api/sessions/${id}`).send({ activeSeconds: 86_400 }).expect(204);
      const db = app.get<Database>(DB);
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
      await http().patch(`/api/sessions/${id}`).send({ activeSeconds: 90 }).expect(204);
      await http().patch(`/api/sessions/${id}`).send({ activeSeconds: 30 }).expect(204);

      const stats = await http().get('/api/stats').expect(200);
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
      const seen = await app
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
      const empty = await http().get(`/api/notes/${lessonId}`).expect(200);
      expect(empty.body).toEqual({ body: '', updatedAt: null });

      const saved = await http().put(`/api/notes/${lessonId}`).send({ body: 'First' }).expect(200);
      expect(saved.body.body).toBe('First');
      await http().put(`/api/notes/${lessonId}`).send({ body: 'Second **draft**' }).expect(200);
      const read = await http().get(`/api/notes/${lessonId}`).expect(200);
      expect(read.body.body).toBe('Second **draft**');
      expect(read.body.updatedAt).toEqual(expect.any(String));

      // The list names what each note is about, in plan order.
      await http().put('/api/notes/m00-demo/t01-explain').send({ body: 'Task note' }).expect(200);
      const all = await http().get('/api/notes').expect(200);
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
      await http().put('/api/notes/m00-demo/t01-explain').send({ body: '' }).expect(200);

      // Search finds a note by its own words, and ranks it above the page it is on.
      const found = await http().get('/api/search?q=draft').expect(200);
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
      const both = await http().get('/api/search?q=first').expect(200);
      expect(both.body.results.map((r: { inNote: boolean }) => r.inNote)).toEqual([false]);

      // An emptied note is removed, not stored as blank text.
      await http().put(`/api/notes/${lessonId}`).send({ body: '   ' }).expect(200);
      const gone = await http().get(`/api/notes/${lessonId}`).expect(200);
      expect(gone.body).toEqual({ body: '', updatedAt: null });

      await http().get('/api/notes/m00-demo/l99-missing').expect(404);
      await http().put('/api/notes/m00-demo/l99-missing').send({ body: 'x' }).expect(404);
      await http()
        .put(`/api/notes/${lessonId}`)
        .send({ body: 'x'.repeat(20_001) })
        .expect(400);
      await http().put(`/api/notes/${lessonId}`).send({}).expect(400);
    });

    it('offers the page opened last, while it is unfinished', async () => {
      // The session test above opened the first lesson, which is done by now.
      const before = await http().get('/api/plan').expect(200);
      expect(before.body.nextUp.continueWith).toBeNull();

      await http()
        .post('/api/sessions')
        .send({ activity: 'task', itemId: 'm00-demo/t02-code' })
        .expect(201);
      const after = await http().get('/api/plan').expect(200);
      expect(after.body.nextUp.continueWith).toEqual({
        kind: 'task',
        id: 'm00-demo/t02-code',
        title: expect.any(String),
        moduleTitle: 'Demo module',
      });
    });

    it('rejects a heartbeat for an unknown session', async () => {
      const res = await http()
        .patch('/api/sessions/00000000-0000-4000-8000-000000000000')
        .send({ activeSeconds: 5 });
      expect(res.status).toBe(404);
    });
  });

  describe('curriculum updates', () => {
    it('brings the cards of finished lessons up to date and respects the learner', async () => {
      const db = app.get<Database>(DB);
      const decks = app.get(DeckSyncService);
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

      expect(await decks.sync()).toEqual({ updated: 1, added: 1 });
      expect((await card('c1'))?.front).toBe('Q1');
      // Only the text changes: the card keeps its place in the schedule.
      expect(await schedule(first.id)).toEqual(scheduleBefore);
      const second = await card('c2');
      expect(second).toMatchObject({ front: 'Q2', status: 'active', source: 'lesson' });
      expect(await decks.sync()).toEqual({ updated: 0, added: 0 });

      // Saving the same text again is not an edit: corrections still arrive.
      await http()
        .patch(`/api/cards/${first.id}`)
        .send({ type: first.type, front: 'Q1', back: first.back })
        .expect(200);
      expect((await card('c1'))?.editedAt).toBeNull();

      // A card the learner reworded, and one they deleted, are left alone.
      await http().patch(`/api/cards/${first.id}`).send({ front: 'My wording' }).expect(200);
      await http().delete(`/api/cards/${second?.id}`).expect(204);
      expect(await decks.sync()).toEqual({ updated: 0, added: 0 });
      expect((await card('c1'))?.front).toBe('My wording');
      expect(await card('c2')).toBeUndefined();
      const again = await http()
        .put('/api/lessons/m00-demo/l01-first/progress')
        .send({ status: 'done' })
        .expect(200);
      expect(again.body.cardsAdded).toBe(0);
    });
  });
});
