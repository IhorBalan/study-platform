---
title: What to test, and at which level
skills: [test-strategy]
---

A test suite is a bet: you pay for every test in writing time, run time and maintenance, and it pays you back each time it catches a bug before a user does. This lesson is about placing those bets well on a backend. The question is never "should this be tested?" but "what is the cheapest test that fails when this breaks?"

## Three levels, named by what is real

The names vary between teams, so define them by what runs for real and what does not.

| Level | What is real | Typical speed | Catches |
| --- | --- | --- | --- |
| Unit | One function or class. No network, no disk, no database. | Microseconds to milliseconds | Logic errors: branches, boundaries, calculations |
| Integration | Your code plus one real dependency, usually the database | Milliseconds to a second | Wrong SQL, constraints, transactions, mapping rows to objects |
| End-to-end (API) | The whole app over HTTP, with its real database | Tens of milliseconds to seconds | Wiring, validation, auth, status codes, error format |

Some teams also say "end-to-end" for a test that drives several deployed services, or a browser. On a backend team it usually means "through the HTTP API". Whatever your team calls them, the useful question is the same: which parts are real, and what can therefore go wrong without the test noticing?

## Cost and value

A unit test is cheap to write, runs in a blink and points straight at the broken line. It also knows nothing about the world outside its function. A unit test of a repository with a mocked `pg` client proves that your code sends a string to `query()`. It does not prove the string is valid SQL, that the column exists, or that the unique constraint fires.

An integration test against a real Postgres catches all of that. It costs a database (a container, or the lab Postgres in this course), a few milliseconds per query, and some thought about isolation, because tests now share state. Lesson 4 covers that.

An HTTP-level test exercises routing, guards, validation pipes, the handler, the database and the exception filter in one go. It is the only level that proves the contract a client sees: `POST /notes` with a bad body returns `400` with a problem document. It is also the slowest to run and the vaguest when it fails: "expected 201, got 500" tells you something broke, not where.

So each level buys different information:

- **Unit tests** give fast, precise feedback on logic. They are worth it when there is logic: branches, arithmetic, parsing, state machines.
- **Integration tests** give confidence that your code and the database agree. On most backends this is where the bugs live, because most of the code is moving data in and out of storage.
- **HTTP tests** give confidence in the contract. A handful per endpoint is usually enough.

## A sensible shape for a backend suite

You may know the test pyramid (many unit tests, fewer integration tests, very few end-to-end) and the frontend "testing trophy", which puts integration tests in the widest band. A typical CRUD-heavy API sits closer to the trophy: little pure logic, lots of SQL. A reasonable default:

- Pull real logic out into pure functions and unit-test it hard, edge cases and all.
- Test every repository or query module against a real database.
- Write HTTP-level tests for each endpoint's contract: the happy path, auth failures, validation failures and the main business-rule errors.
- Keep one or two true end-to-end flows (API plus worker plus a fake external service) as a smoke test, if the system has moving parts between services.

The shape follows the code. A pricing engine with hundreds of rules wants many unit tests. A thin API over Postgres wants mostly integration tests. Let the bugs you actually ship tell you where to invest.

## Worked example: one endpoint, three levels

Take `POST /orders/:id/refunds`. Only the order's owner may refund, at most the amount paid, and only within 30 days.

The 30-day rule and the amount check are pure logic once the order is loaded. Extract them:

```ts
// src/refunds/refund-policy.ts
export type RefundDecision = { ok: true } | { ok: false; reason: 'too-late' | 'too-much' };

export function checkRefund(
  order: { paidCents: number; refundedCents: number; paidAt: Date },
  amountCents: number,
  now: Date,
): RefundDecision {
  const ageMs = now.getTime() - order.paidAt.getTime();
  if (ageMs > 30 * 24 * 60 * 60 * 1000) return { ok: false, reason: 'too-late' };
  if (amountCents > order.paidCents - order.refundedCents) return { ok: false, reason: 'too-much' };
  return { ok: true };
}
```

Now the boundaries are cheap to test: exactly 30 days, 30 days plus one millisecond, the full remaining amount, one cent over, a second partial refund. These are unit tests, and you can write ten of them in five minutes.

```ts
import { describe, expect, it } from 'vitest';
import { checkRefund } from './refund-policy.js';

const paidAt = new Date('2026-03-01T12:00:00Z');
const order = { paidCents: 5000, refundedCents: 2000, paidAt };
const DAY = 24 * 60 * 60 * 1000;

describe('checkRefund', () => {
  it('allows the full remaining amount', () => {
    expect(checkRefund(order, 3000, paidAt)).toEqual({ ok: true });
  });

  it('refuses one cent more than remains', () => {
    expect(checkRefund(order, 3001, paidAt)).toEqual({ ok: false, reason: 'too-much' });
  });

  it('still allows a refund exactly 30 days after payment', () => {
    expect(checkRefund(order, 100, new Date(paidAt.getTime() + 30 * DAY)).ok).toBe(true);
  });
});
```

Writing the refund row and updating `refunded_cents` in one transaction, so that two parallel refunds cannot both pass the check, depends on SQL and locking. A mock cannot show that. It belongs in an integration test against Postgres.

The owner check lives in a guard, and the `400` for a negative amount in a validation pipe. Neither runs unless a request goes through the Nest lifecycle, so they get HTTP-level tests: no token gives `401`, someone else's order gives `403`, `{ "amountCents": -5 }` gives `400`. One happy-path HTTP test checks the `201` and the response shape.

That is about a dozen tests in total: most of them fast unit tests, a couple of integration tests, and four or five HTTP tests. Each case sits at the cheapest level that can catch its bug.

## Test behaviour, not implementation

A good test describes what the code promises, not how it keeps the promise. "Returns `too-late` after 30 days" survives any refactor that keeps the rule. "Calls `getTime()` twice" breaks the day someone tidies up the code, and catches no bug in the meantime. Tests that are tied to the implementation make refactoring expensive, and teams stop refactoring.

The same idea from React Testing Library applies: query by what the user sees, not by component internals. For an API, the "user" is the caller of a function or the client of an endpoint.

Three more properties make a test worth keeping:

- **It fails for one reason.** A test named "refuses one cent more than remains" that also checks the 30-day rule is two tests.
- **It is deterministic.** Same code, same result, every run. Lesson 6 is about the usual enemies: time, randomness, order and shared state.
- **Its failure message helps.** `expected 3000, got 3001` beats `expected true, got false`.

## Common mistakes

- Unit-testing a repository with a mocked database driver and calling it covered. The SQL was never run.
- Writing only HTTP tests. Each runs the whole stack, so the suite is slow, and a failure says "500" without saying where.
- Testing the framework: that Nest routes `GET /notes` to the right method, or that zod rejects a number where it expects a string.
- Leaving business rules inside the handler, where only a slow HTTP test can reach them.
- Chasing a test count or a coverage number instead of asking which bugs the suite would catch.

## Go deeper

- [Martin Fowler: The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html): the classic layering, with concrete examples per level.
- [Vitest: Getting started](https://vitest.dev/guide/): the runner used in this module's lessons.
- [NestJS: Testing](https://docs.nestjs.com/fundamentals/testing): unit and end-to-end tests in a Nest project.
- [Node.js: Test runner](https://nodejs.org/api/test.html): the built-in runner the tasks use.
