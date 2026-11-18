import 'reflect-metadata';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('API (e2e, real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine').start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.CURRICULUM_DIR = path.join(import.meta.dirname, 'fixtures/curriculum');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await container?.stop();
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
        tasks: [{ id: 'm00-demo/t01-explain', type: 'text' }],
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
        labFolder: 'lab/m00-demo/t01-explain',
        rubric: [{ id: 'clarity', max: 4 }],
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
    });

    it('survives a second review of the same card (stored state round-trips)', async () => {
      const list = await http().get('/api/cards').expect(200);
      const reviewed = list.body.cards.find((c: { reps: number }) => c.reps === 1);
      const res = await http()
        .post(`/api/review/${reviewed.id}`)
        .send({ grade: 'again' })
        .expect(200);
      expect(['learning', 'relearning', 'review']).toContain(res.body.state);
      const again = await http().get('/api/cards').expect(200);
      expect(again.body.cards.find((c: { id: string }) => c.id === reviewed.id).reps).toBe(2);
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

    it('validates settings', async () => {
      const res = await http().patch('/api/settings').send({ desiredRetention: 1.5 });
      expect(res.status).toBe(400);
    });
  });
});
