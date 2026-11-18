---
title: "Testing a Nest app: a preview"
skills: [nest-testing]
---

Dependency injection pays off most visibly in tests. Because no class creates its own collaborators, a test can build the real module graph and swap out exactly the parts it does not want. This lesson shows the two moves you need now. Module 5 covers test strategy, databases and test doubles in depth.

## A testing module

`@nestjs/testing` provides `Test.createTestingModule()`. It takes the same metadata as `@Module()` and returns a builder. Call `compile()` and you have a container that never opened a port.

```ts
import { Test } from '@nestjs/testing';
import { beforeEach, expect, it } from 'vitest';
import { ENV } from '../config/env.js';
import { NotesService } from './notes.service.js';

let notes: NotesService;

beforeEach(async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [NotesService, { provide: ENV, useValue: { MAX_NOTES: 2 } }],
  }).compile();
  notes = moduleRef.get(NotesService);
});

it('refuses a note when the store is full', () => {
  notes.create({ title: 'one' });
  notes.create({ title: 'two' });
  expect(() => notes.create({ title: 'three' })).toThrow(/maximum/);
});
```

For a class this small, `new NotesService({ MAX_NOTES: 2 })` would do the same job with less machinery, and that is a perfectly good unit test. The testing module earns its keep when the graph is deeper, or when you want proof that the wiring itself (tokens, exports, factories) works.

Building a fresh module in `beforeEach` gives every test its own singletons. In-memory state then cannot leak from one test to the next.

## Overriding providers

More often you import a real module and replace one provider in it. This is the React Testing Library habit of wrapping a component in a test provider, applied to the server:

```ts
const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(ENV)
  .useValue({ NODE_ENV: 'test', PORT: 0, MAX_NOTES: 2, ADMIN_TOKEN: 'x'.repeat(16) })
  .compile();
```

`overrideProvider(token)` accepts `useValue`, `useClass` or `useFactory`, like a custom provider. Everything else stays real, so the test exercises the actual modules. Override what is slow, non-deterministic or external: the clock, a payment client, outgoing email. Avoid overriding the thing under test. A test in which every collaborator is fake mostly tests the fakes.

There are matching `overrideGuard`, `overridePipe`, `overrideInterceptor` and `overrideFilter` methods for the lifecycle pieces.

## An HTTP-level test

The most valuable test for an API sends a real request through the whole lifecycle: middleware, guards, pipes, handler and filters. Create an application from the testing module and listen on port `0`, which asks the operating system for any free port:

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

let app: INestApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});

afterAll(async () => {
  await app.close();
});

it('rejects a note without a title', async () => {
  const res = await fetch(`${base}/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'no title' }),
  });
  expect(res.status).toBe(400);
  expect(res.headers.get('content-type')).toContain('application/problem+json');
});
```

Generated Nest projects usually do this with the `supertest` package: `request(app.getHttpServer()).post('/notes').send({...}).expect(400)`. It takes the HTTP server object directly, so you call `app.init()` and need no port. Both styles hit the same code. The checks for this module's tasks use the `fetch` style.

This kind of test is also why earlier lessons insisted on `APP_PIPE` and `APP_FILTER`. `main.ts` does not run here. Anything configured only in `main.ts`, such as `app.useGlobalPipes(...)`, is missing from the app under test, and the test would pass or fail for the wrong reasons.

## The runner needs decorator metadata

New ESM Nest projects use Vitest. Vitest's default transformer does not emit `design:paramtypes`, so constructor injection finds nothing unless the test files are compiled by something that does. Generated projects configure SWC for this. If every injected dependency in your tests is suddenly `undefined`, look at the transformer set-up before you look at your code, and check the current docs for the recommended configuration.

## Common mistakes

- Forgetting `await app.close()`. Open servers and connections keep the test process alive.
- Hard-coding a port. Parallel test files collide; use `0`.
- Sharing one app across tests that mutate its in-memory state, then depending on test order.
- Overriding so many providers that no real code is left to fail.
- Testing only services. Validation, status codes and error format live in the lifecycle and need an HTTP-level test.
- Configuring pipes and filters in `main.ts` and testing an app that lacks them.

## Go deeper

- [NestJS: Testing](https://docs.nestjs.com/fundamentals/testing): the testing module, overrides, auto-mocking and end-to-end tests.
- [NestJS: Custom providers](https://docs.nestjs.com/fundamentals/custom-providers): the provider forms that overrides reuse.
- [Vitest: Guide](https://vitest.dev/guide/): the runner, hooks and assertions used above.
- [Node.js: net, `server.listen()`](https://nodejs.org/api/net.html): what port `0` means and how `address()` reports the chosen port.
