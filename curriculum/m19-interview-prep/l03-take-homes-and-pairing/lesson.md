---
title: Take-homes and pair programming
skills: [interview-take-home]
---

The take-home and the pairing session are the rounds where you actually write backend code for someone. Both are judged less on whether the code works (most submissions roughly work) and more on how you scope, structure, test and explain it. This lesson covers how they are scored, how to plan a time box, and the mistakes that sink otherwise good submissions.

## What reviewers look for

Reviewers at small companies read take-homes with a short list in mind. In rough order of weight:

1. **It runs from the README.** One command to install, one to test, one to start. If the reviewer cannot run it in two minutes, everything else is read with suspicion.
2. **Tests.** Not coverage numbers. Tests for the behaviour that matters and for the edge cases the brief hinted at.
3. **Structure.** Clear separation between HTTP handling, business logic and storage. A reviewer should find the core rule in one file.
4. **Input validation and error handling.** Bad input gets a 400 with a useful body, not a 500 with a stack trace.
5. **A README that states assumptions and trade-offs.** What you assumed when the brief was vague, what you chose not to do and why, what you would do next.
6. **Scope discipline.** Do what was asked, well. A polished small solution beats a sprawling half-finished one.

Then comes the follow-up call. You walk through the code, they ask why you made certain choices, and often they ask you to add a feature or fix a bug live. Everything you wrote, you must be able to defend. That includes code an AI assistant suggested.

## Planning a time box

Most briefs say "about 4 hours" or "no more than 90 minutes". Treat the number as a hard limit, and say in the README how long you took. Going far over is not a virtue: it hides how you prioritise, and some companies compare submissions at equal effort.

A budget for a 90-minute exercise:

| Minutes | Activity |
| --- | --- |
| 0 to 10 | Read the brief twice. List requirements and ambiguities. Write assumptions into the README straight away. |
| 10 to 20 | Sketch the module boundaries and the public function signatures. Write the first failing test. |
| 20 to 65 | Build the core logic test-first, smallest slice end to end, then widen. |
| 65 to 80 | Edge cases, error handling, input validation. |
| 80 to 90 | README: how to run, assumptions, trade-offs, what is next. Read your own diff once. |

The last ten minutes for the README are not optional. A missing README costs more than a missing feature.

## Structure that reads well

For a small API, three layers are enough:

```text
src/
  core.ts      pure logic, no HTTP, no I/O. Takes a clock and a store as inputs.
  store.ts     persistence (in memory or Postgres), behind a small interface
  server.ts    HTTP: parse, validate, call core, map errors to status codes
test/
  core.test.ts
  server.test.ts
README.md
```

Keeping HTTP out of the core makes it easy to test without starting a server, and lets the reviewer see the business rules in one place. Injecting the clock makes time-based rules (rate limits, expiry) testable without `sleep`.

Map domain errors to HTTP in one place instead of sprinkling status codes through the logic:

```ts
export class ValidationError extends Error {}
export class ConflictError extends Error {}

export function toStatus(error: unknown): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof ConflictError) return 409;
  return 500;
}
```

## Tests that earn points

Write the tests the reviewer would write. For each requirement in the brief, one happy-path test and one test for its most likely failure. Name tests after behaviour, not functions:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShortener, RateLimitError } from '../shortener.mjs';

test('a client that exceeds its limit is rejected until tokens refill', () => {
  let now = 0;
  const s = createShortener({ clock: () => now, rateLimit: { capacity: 2, refillPerSecond: 1 } });
  s.shorten('https://a.example', { clientId: 'c1' });
  s.shorten('https://b.example', { clientId: 'c1' });
  assert.throws(() => s.shorten('https://c.example', { clientId: 'c1' }), RateLimitError);
  now += 1000;
  assert.ok(s.shorten('https://c.example', { clientId: 'c1' }).code);
});
```

A good test fails when the code is wrong. Before you submit, break one rule on purpose (make the limiter never limit) and check that a test goes red. That habit is exactly what task 3 checks.

## A README template

```markdown
# Link shortener

## Run
npm test          # unit and HTTP tests
npm start         # http://localhost:3000

## Assumptions
- Aliases are case-sensitive, 4 to 32 characters.
- Rate limit is per client id header, falling back to IP.

## Trade-offs
- In-memory store: simple and fast to test; data is lost on restart.
  A Postgres table with a unique index on code is the next step.
- Token bucket over fixed window: smoother, no burst at window edges.

## Not done (would do next)
- Persistence, metrics, URL blocklist.

Time spent: about 85 minutes.
```

## Pair programming rounds

Pairing is a take-home compressed into an hour with an audience. What changes:

- **Clarify first.** Restate the problem in one sentence, ask two or three questions, agree on the first small slice.
- **Narrate decisions, not keystrokes.** "I'll put the limit check before validation so abusive clients cost us less" is useful. "Now I'm typing a for loop" is not.
- **Run code early and often.** A tiny test or a `node` one-liner beats ten minutes of reasoning.
- **Use the interviewer.** They are a teammate in this format. "Would you check this with a unique constraint or in code?" is a fine question.
- **When stuck, say so and choose a way forward.** "I don't remember the exact API; I'll write it this way and check the docs" is what real work looks like.

If the company allows AI tools in the round, use them the way you would at work: for boilerplate and lookup, and read every line before you run it. Interviewers watch whether you check the output.

## Common mistakes

- No README, or a README that does not say how to run the tests.
- Over-scoping: adding auth, Docker and a frontend nobody asked for, and leaving the core rule untested.
- Business logic inside route handlers, so nothing can be tested without HTTP.
- Tests that only cover the happy path, or that would pass if the rule were deleted.
- Letting every error become a 500.
- Not stating the time spent, or going far over the time box silently.
- Submitting code you cannot explain on the follow-up call.

## Go deeper

- [Node.js test runner](https://nodejs.org/api/test.html): `node:test`, mocks and timers, enough for any take-home without dependencies.
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457): a standard error body reviewers recognise.
- [Trunk.io: how we crack the coding interview](https://trunk.io/blog/how-we-crack-the-coding-interview): a startup explains what it looks for in practical rounds.
- [Node.js: URL API](https://nodejs.org/api/url.html): parsing and validating URLs with `new URL()` and `URL.canParse()`.
