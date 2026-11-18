---
title: Testing a NestJS app
skills: [nest-testing, test-doubles]
---

Module 2 previewed `Test.createTestingModule()` and an HTTP test with `fetch`. This lesson puts the pieces together into the suite a real Nest service needs: plain unit tests for providers, a testing module when the wiring matters, HTTP tests with Supertest against a real database, and a small set of overrides for what is slow or non-deterministic. The guiding rule from lesson 3 still holds: keep as much real as you can afford.

## Level 1: a provider is just a class

A service with injected dependencies is a class with constructor parameters. For a unit test you do not need Nest at all:

```ts
import { describe, expect, it } from 'vitest';
import { InvitesService } from './invites.service.js';
import { InMemoryInvitesStore } from '../../test/fakes/in-memory-invites-store.js';

describe('InvitesService', () => {
  it('replaces a pending invite for the same email instead of adding one', async () => {
    const store = new InMemoryInvitesStore();
    const service = new InvitesService(store, { now: () => new Date('2026-01-01T09:00:00Z') });
    await service.invite('ws1', 'ada@example.com');
    await service.invite('ws1', 'ADA@example.com');
    expect(await store.pending('ws1')).toHaveLength(1);
  });
});
```

This runs in milliseconds and tests the rule, nothing else. Reach for the testing module only when you want Nest to build the object graph.

## Level 2: the testing module

`Test.createTestingModule()` takes the same metadata as `@Module()` and builds a real container. Use it when the wiring is part of what you want to prove: tokens, factories, exports between modules, lifecycle hooks.

```ts
const moduleRef = await Test.createTestingModule({ imports: [InvitesModule] })
  .overrideProvider(CLOCK)
  .useValue({ now: () => new Date('2026-01-01T09:00:00Z') })
  .compile();

const service = moduleRef.get(InvitesService);
```

`overrideProvider(token)` accepts `useValue`, `useClass` or `useFactory`. There are matching `overrideGuard`, `overridePipe`, `overrideInterceptor`, `overrideFilter` and `overrideModule`.

Nest can also create doubles for every missing dependency automatically, with `.useMocker((token) => ...)`. It is handy for testing a controller in isolation from its service. Be wary of it: a controller test with an auto-mocked service checks that one method calls another, which is the over-mocking trap from lesson 3. The behaviour of a controller (status codes, validation, the response shape) lives in the request lifecycle, and that is best tested over HTTP.

## Level 3: HTTP tests with Supertest

Supertest sends real HTTP requests to an in-process server and gives you a fluent API for the response. It accepts the Node HTTP server directly and binds a free port on its own, so you call `app.init()` rather than `listen()`.

```sh
npm install -D supertest @types/supertest
```

The app below keeps its `pg.Pool` under a `DATABASE_POOL` token and its clock under `CLOCK`. The test replaces both: the pool with one pointing at the test database from lesson 4, and the clock with a fixed one.

```ts
// test/invites.e2e.test.ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { CLOCK } from '../src/common/clock.js';
import { DATABASE_POOL } from '../src/database/database.module.js';
import { seedWorkspace, tokenFor } from './helpers.js';

let app: INestApplication;
let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: inject('databaseUrl'), max: 2 });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_POOL)
    .useValue(pool)
    .overrideProvider(CLOCK)
    .useValue({ now: () => new Date('2026-01-01T09:00:00Z') })
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE workspaces, members, invites RESTART IDENTITY CASCADE');
});

describe('POST /workspaces/:id/invites', () => {
  it('creates an invite and points to it', async () => {
    const { workspaceId, adminId } = await seedWorkspace(pool);

    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${tokenFor(adminId)}`)
      .send({ email: 'Ada@Example.com', role: 'member' })
      .expect(201);

    expect(res.headers.location).toBe(`/workspaces/${workspaceId}/invites/${res.body.id}`);
    expect(res.body).toMatchObject({ email: 'ada@example.com', expiresAt: '2026-01-08T09:00:00.000Z' });
    expect(res.body).not.toHaveProperty('token');
  });

  it('answers 401 without a token', async () => {
    const { workspaceId } = await seedWorkspace(pool);
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/invites`)
      .send({ email: 'ada@example.com', role: 'member' })
      .expect(401);
  });

  it('answers 400 with a problem document for an unknown role', async () => {
    const { workspaceId, adminId } = await seedWorkspace(pool);
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${tokenFor(adminId)}`)
      .send({ email: 'ada@example.com', role: 'owner' })
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);
    expect(res.text).toContain('role');
  });
});
```

What this buys: one request runs the guard, the validation pipe, the controller, the service, real SQL against Postgres, and the exception filter. Everything a client relies on is checked: the status, the `Location` header, the normalised email, the expiry computed from the fixed clock, and that the secret token is not in the body.

A few rules keep such tests trustworthy:

- **Build the app from `AppModule`, the same as production.** Then register global pipes, guards and filters through providers (`APP_PIPE`, `APP_GUARD`, `APP_FILTER`), not in `main.ts`, which tests never run.
- **Seed through helpers, not through other endpoints.** `seedWorkspace(pool)` inserts rows directly. If every test first called `POST /workspaces`, a bug there would fail the whole suite.
- **Use a real token for auth tests.** `tokenFor(userId)` signs a JWT with the test configuration's secret, so the real guard runs. For tests about something else, `overrideGuard(AuthGuard).useValue({ canActivate: () => true })` is tempting, but then nothing proves the guard is wired to that route. Keep at least the `401` and `403` cases real for each protected endpoint.
- **Override at the edges only:** the clock, random token generators, outgoing HTTP clients (payment, email), message brokers you do not run in tests. The database is not an edge; it is part of what you are testing.
- **Close everything.** `app.close()` runs the shutdown hooks; the pool you created yourself, you end yourself.

## The transformer must emit decorator metadata

Nest's constructor injection reads `design:paramtypes` metadata, which the TypeScript compiler emits when `emitDecoratorMetadata` is on. The transform Vitest uses by default has not emitted it, and without it every injected dependency is `undefined`. Nest projects that use Vitest therefore add the SWC plugin `unplugin-swc` to the Vitest config; the NestJS SWC recipe shows the current set-up. If injected services are `undefined` only in tests, check this first.

The same limitation applies to Node's own type stripping, which does not support decorators at all. To test a Nest app with `node:test`, compile it with `tsc` first and import the JavaScript output, as this course's check suites do.

## How many HTTP tests?

Per endpoint, a typical set is: the happy path with the full response shape, missing or invalid authentication, a forbidden caller, one or two invalid bodies (to prove the pipe is attached, not to re-test every rule of the schema), and each business-rule error the endpoint can return (`404`, `409`, `422`). Push the long tail of edge cases down to unit and integration tests, where they are cheaper.

## Common mistakes

- Overriding the service under test, so the HTTP test checks only the controller's plumbing.
- `useMocker` everywhere, which turns every Nest test into an interaction test.
- Seeding through other endpoints, so one bug fails fifty tests.
- Global pipes or filters configured in `main.ts`, missing from the app under test.
- Sharing one app across files that mutate the same tables without isolation.
- Forgetting `app.close()`, leaving open handles that hang the run.

## Go deeper

- [NestJS: Testing](https://docs.nestjs.com/fundamentals/testing): `createTestingModule`, overrides, `useMocker` and end-to-end tests.
- [NestJS: SWC recipe](https://docs.nestjs.com/recipes/swc): the Vitest set-up that keeps decorator metadata.
- [Supertest on npm](https://www.npmjs.com/package/supertest): the request and assertion API.
- [NestJS: Custom providers](https://docs.nestjs.com/fundamentals/custom-providers): the provider forms that overrides reuse.
