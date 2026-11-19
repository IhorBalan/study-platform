import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { schema } from '@study/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { JSON_BODY_LIMIT } from '../src/common/body-limit.js';
import { DB, type Database } from '../src/database/database.module.js';
import type { E2eContext } from './e2e/context.js';
import { writeProtectionTests } from './e2e/write-protection.js';
import { curriculumTests } from './e2e/curriculum.js';
import { submissionsTests } from './e2e/submissions.js';
import { spacedRepetitionTests } from './e2e/spaced-repetition.js';
import { planAndStatsTests } from './e2e/plan-and-stats.js';
import { curriculumUpdatesTests } from './e2e/curriculum-updates.js';

describe('API (e2e, real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let bridge: Server;
  const ctx: E2eContext = {
    // Filled in by beforeAll, before any test reads it.
    app: undefined as unknown as NestExpressApplication,
    bridgeReplies: [],
    bridgeDelayMs: 0,
    http: () => request(ctx.app.getHttpServer()),
    makeDue: async (cardId) => {
      await ctx.app
        .get<Database>(DB)
        .update(schema.cardSchedules)
        .set({ due: new Date(Date.now() - 60_000) })
        .where(eq(schema.cardSchedules.cardId, cardId));
    },
  };
  const http = ctx.http;

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
                ctx.bridgeReplies.shift() ?? {
                  status: 'error',
                  message: 'no reply queued',
                  output: '',
                  model: null,
                  costUsd: null,
                  durationMs: 1,
                },
              ),
            );
          }, ctx.bridgeDelayMs);
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => bridge.listen(0, '127.0.0.1', resolve));
    process.env.BRIDGE_URL = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
    process.env.BRIDGE_SECRET = 'test-secret-that-is-long-enough-123';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
    app.setGlobalPrefix('api');
    await app.init();
    ctx.app = app;
  });

  afterAll(async () => {
    await ctx.app?.close();
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

  writeProtectionTests(ctx);
  curriculumTests(ctx);
  submissionsTests(ctx);
  spacedRepetitionTests(ctx);
  planAndStatsTests(ctx);
  curriculumUpdatesTests(ctx);
});
