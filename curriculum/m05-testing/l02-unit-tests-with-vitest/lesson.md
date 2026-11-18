---
title: Unit tests with Vitest
skills: [unit-testing]
---

Vitest is the default test runner for new TypeScript backends, including ESM NestJS projects. If you have used Jest or Vitest on the frontend, the API is the one you know. This lesson covers what is different about unit-testing server code: async everywhere, errors as part of the contract, and time. At the end is a table that maps Vitest to Jest, which many existing codebases still run, and to `node:test`, which this module's tasks use.

## Setting up

```sh
npm install -D vitest
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
```

`npx vitest` watches files and reruns affected tests. `npx vitest run` runs once, which is what CI uses. Vitest transforms TypeScript itself, so there is no build step before the tests. Import `describe`, `it` and `expect` from `vitest`; set `globals: true` only if you want Jest-style globals.

## Structure: arrange, act, assert

Keep each test in three visible parts: set up the inputs, call the code once, check the result.

```ts
// src/slugify.ts
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

```ts
// src/slugify.test.ts
import { describe, expect, it } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lower-cases and joins words with hyphens', () => {
    const title = 'Hello World';         // arrange
    const slug = slugify(title);         // act
    expect(slug).toBe('hello-world');    // assert
  });

  it.each([
    { input: '  padded  ', expected: 'padded' },
    { input: 'Crème brûlée', expected: 'creme-brulee' },
    { input: 'a--b', expected: 'a-b' },
    { input: '!!!', expected: '' },
  ])('turns $input into "$expected"', ({ input, expected }) => {
    expect(slugify(input)).toBe(expected);
  });
});
```

`it.each` turns a table into one named test per row. When a row fails, the report names the input, which a loop of `expect` calls inside one test does not.

Name tests as statements about behaviour: "lower-cases and joins words with hyphens". Read together, the names should work as a specification.

## Assertions that say what you mean

| Matcher | Use it for |
| --- | --- |
| `toBe(x)` | Primitives and identity (`Object.is`) |
| `toEqual(x)` | Deep equality; ignores properties that are `undefined` |
| `toStrictEqual(x)` | Deep equality that also compares `undefined` properties and class types |
| `toMatchObject(x)` | The object has at least these properties; extra ones are fine |
| `toThrow(ErrorClass or /message/)` | A synchronous function throws |
| `toHaveLength(n)`, `toContain(x)` | Arrays and strings |

`toEqual` versus `toStrictEqual` matters on a backend. An API response `{ id: 1, deletedAt: undefined }` serialises to `{"id":1}`, so `toEqual` treats the two as the same. Use `toStrictEqual` when the exact shape is the contract. Use `toMatchObject` when you only care about some fields, such as a created row whose `id` and `createdAt` you cannot predict:

```ts
expect(note).toMatchObject({ title: 'Buy milk', body: '' });
expect(note.id).toEqual(expect.any(String));
```

## Async code and errors

Most backend code returns promises. Always `await` the assertion, or the test finishes before the promise settles and passes no matter what:

```ts
it('rejects an unknown user', async () => {
  await expect(users.findOrFail('nope')).rejects.toThrow(NotFoundError);
});

it('loads a user', async () => {
  await expect(users.findOrFail('u1')).resolves.toMatchObject({ id: 'u1' });
});
```

A forgotten `await` before `expect(...).rejects` is one of the most common silent bugs in test suites. The lint rule `@typescript-eslint/no-floating-promises` catches it.

When an assertion sits inside a callback that may never run, add `expect.assertions(n)` at the top of the test. The test then fails if fewer assertions ran.

Errors are part of a backend's contract, so test them as carefully as success: the error class, a code the caller depends on, and that nothing was written when the operation failed.

## Fake timers

Code with timeouts, retries, debounce or expiry would make the test wait for real. Fake timers replace `setTimeout`, `setInterval` and `Date` with versions that only move when the test says so.

```ts
// src/retry.ts
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 1000): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
}
```

```ts
// src/retry.test.ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withRetry } from './retry.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('succeeds on the third attempt after 1 s and 2 s of backoff', async () => {
  const fn = vi
    .fn()
    .mockRejectedValueOnce(new Error('boom'))
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue('ok');

  const result = withRetry(fn);
  await vi.advanceTimersByTimeAsync(3000);

  await expect(result).resolves.toBe('ok');
  expect(fn).toHaveBeenCalledTimes(3);
});

it('gives up after the last attempt', async () => {
  const fn = vi.fn().mockRejectedValue(new Error('boom'));
  const assertion = expect(withRetry(fn)).rejects.toThrow('boom');
  await vi.advanceTimersByTimeAsync(3000);
  await assertion;
});
```

Two details. Use the `Async` variants (`advanceTimersByTimeAsync`) when timers and promises interleave, as they do here: they let pending promise callbacks run between timers. And in the failure test, attach the `rejects` assertion before advancing time, or the rejection happens while nobody is listening and the runner reports an unhandled rejection.

For "what time is it now", `vi.setSystemTime(new Date('2026-01-01T09:00:00Z'))` sets the fake `Date`. Fake timers are a global patch, and that has costs: they affect every library in the process, and they can hang code that waits on a timer you never advance. Lesson 3 shows the alternative that this module prefers for your own code: pass a clock in.

## Vitest, Jest and node:test side by side

Most of the API is shared. These are the calls you will reach for most:

| Purpose | Vitest | Jest | node:test |
| --- | --- | --- | --- |
| Group and define | `describe`, `it`, `test` (imported) | the same, as globals | `describe`, `it`, `test` from `node:test` |
| Hooks | `beforeEach`, `afterAll`, ... | the same | `beforeEach`, `after`, ... |
| Equality | `expect(a).toBe(b)`, `toEqual` | the same | `assert.equal(a, b)`, `assert.deepEqual` from `node:assert/strict` |
| Throws / rejects | `toThrow`, `await expect(p).rejects` | the same | `assert.throws(fn)`, `await assert.rejects(p)` |
| Table tests | `it.each([...])` | `it.each([...])` | a `for` loop around `test()` |
| Mock function | `vi.fn()` | `jest.fn()` | `mock.fn()` |
| Spy on a method | `vi.spyOn(obj, 'm')` | `jest.spyOn(obj, 'm')` | `mock.method(obj, 'm')` |
| Mock a module | `vi.mock('./x.js')` | `jest.mock('./x')` | `mock.module()`, behind a flag |
| Fake timers | `vi.useFakeTimers()` | `jest.useFakeTimers()` | `mock.timers.enable({ apis: [...] })` |
| Advance time | `vi.advanceTimersByTime(ms)` | `jest.advanceTimersByTime(ms)` | `mock.timers.tick(ms)` |
| Set the clock | `vi.setSystemTime(d)` | `jest.setSystemTime(d)` | `mock.timers.setTime(ms)` |
| Watch mode | `vitest` | `jest --watch` | `node --test --watch` |

Differences that bite when you move between them:

- Jest needs a transformer (`ts-jest`, Babel or SWC) for TypeScript, and extra set-up for native ESM. Vitest handles both out of the box. `node:test` runs `.ts` files directly on current Node by stripping types, as long as the code uses no syntax that needs compiling, such as `enum`.
- Both `vi.mock` and `jest.mock` are hoisted above the imports, so a mock factory cannot use variables from the test file unless you wrap them in `vi.hoisted()` (Vitest).
- `node:test` has no `expect`. `node:assert/strict` covers the same ground with fewer helpers, and `t.plan(n)` replaces `expect.assertions(n)`.

The ideas carry over one-to-one. In this module's tasks you write `node:test`, because it ships with Node and the check sandbox has no internet.

## Common mistakes

- A missing `await` before `expect(...).rejects`, so the test passes before the promise settles.
- `toEqual` where the exact shape matters, hiding an `undefined` field that a client will notice.
- Many unrelated assertions in one test, so the first failure hides the rest.
- Fake timers enabled in one test and never restored, breaking the next one.
- Testing private helpers directly instead of the public function that uses them.

## Go deeper

- [Vitest: Getting started](https://vitest.dev/guide/): installation, configuration and the CLI.
- [Vitest: The `vi` utility](https://vitest.dev/api/vi): mocks, spies and fake timers.
- [Vitest: Migration guide](https://vitest.dev/guide/migration): the differences from Jest in detail.
- [Node.js: Test runner](https://nodejs.org/api/test.html): `node:test`, its mocks and `mock.timers`.
- [Jest: Getting started](https://jestjs.io/docs/getting-started): for codebases that still run Jest.
