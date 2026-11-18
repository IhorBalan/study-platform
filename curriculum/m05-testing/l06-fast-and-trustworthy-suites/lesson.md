---
title: Keeping a suite fast and trustworthy
skills: [test-reliability, test-strategy]
---

A test suite is only useful while people believe it. A suite that fails one run in twenty for no reason teaches the team to press "re-run" instead of reading the failure, and then it stops catching bugs, because real failures get re-run too. A suite that takes fifteen minutes stops being run before each push. This lesson is about the two properties that keep a suite in use: determinism and speed, plus an honest reading of coverage and a sensible CI set-up.

## Flaky tests: the usual suspects

A flaky test passes and fails on the same code. It is almost never "just CI being weird". It is a test, or code, that depends on something it does not control. The causes repeat across every codebase:

| Cause | Symptom | Fix |
| --- | --- | --- |
| **Time** | Fails around midnight, at month end, in another time zone, or when the machine is slow | Inject a clock; set `TZ=UTC` in CI; never compare against `new Date()` taken in the test |
| **Randomness** | Fails for some generated values | Inject the random source or seed it, and print the seed on failure |
| **Order and shared state** | Passes alone, fails in the full run, or the reverse | Isolate each test (fresh instances, transactions, truncation); run shuffled to find it |
| **Async races** | A `sleep(100)` that is usually long enough | Await the actual event, or poll for the condition with a timeout |
| **Unordered results** | A query without `ORDER BY` returns rows in a different order | Order in the query, or sort before comparing |
| **External services** | Fails when a third-party API is slow or down | Replace the outbound client at the edge with a stub or fake |
| **Ports and handles** | `EADDRINUSE`, or the run hangs at the end | Listen on port `0`; close servers and pools in after-hooks |
| **Parallel files on one database** | Rows appear that the test never created | A database per worker, or run those files serially |

Two of these deserve a closer look.

### Waiting for something to happen

The fragile version sleeps and hopes:

```ts
await request(app.getHttpServer()).post('/exports').expect(202);
await new Promise((r) => setTimeout(r, 500)); // the worker is usually done by then
expect(await exports.status(id)).toBe('done');
```

On a loaded CI machine 500 ms is sometimes not enough, so the test flakes. On a fast laptop it wastes half a second on every run. Poll for the condition instead, with a deadline:

```ts
await expect.poll(() => exports.status(id), { timeout: 5000, interval: 50 }).toBe('done');
```

`expect.poll` (Vitest) retries the callback until the assertion passes or the timeout runs out. It returns as soon as the job is done, and it fails with a clear message when the job never finishes. Better still, when you can call the worker's handler directly in the test, do that and skip the waiting entirely.

### Order dependence

A test that only passes after another test has run, or only on an empty table, hides until something changes the order or the data. Make order part of the run: Vitest can shuffle with `vitest run --sequence.shuffle`, and Node's runner with `node --test --test-randomize`. Both use a seed that you can pass again (`--sequence.seed`, `--test-random-seed`) to reproduce a failing order. Running the suite twice in a row against the same database finds the "only on an empty table" kind. This module's third task is checked exactly that way.

## What to do with a flaky test

1. **Reproduce it.** Run only that test in a loop, a few hundred times if needed. Run it shuffled, under load, with `TZ` set to somewhere far away (`TZ=Pacific/Kiritimati`), with the seed from the failing run.
2. **Fix the cause**, using the table above. Most fixes make the code better, not only the test: an injected clock and an `ORDER BY` are improvements.
3. **If you cannot fix it today, quarantine it** with an owner and a date: skip it with a ticket link, so it stops training the team to ignore red builds.

What not to do: turn on automatic retries for the whole suite. Retries make the build green and hide the race, and some of those races are real bugs in production code. If you use `--retry` at all, keep it local to a known case, and treat "passed on retry" as a failure to investigate.

## Determinism by design

Most flakiness is designed out, not debugged out. The habits from earlier lessons are the design:

- **Time and randomness come in as dependencies** (lesson 3), with fixed values in tests.
- **Every test creates the data it needs** and asserts only on that data (lesson 4).
- **Every test can run alone and in any order.** If a test needs a set-up step, it is in a hook or a helper, not in the previous test.
- **Results that have no defined order get one**, in the query or in the test.
- **No real network** in unit and integration tests. CI without outbound internet is a good way to enforce it.

## Speed

Measure first: Vitest and `node --test` both print per-file and per-test durations. The slow tests are usually a few specific ones, and the causes are usually these:

- Real waiting (`sleep`, real timers, real retry backoff). Use fake timers or injected clocks.
- Repeated expensive set-up: a container or migration per file, an app built per test. Move it to global set-up or `beforeAll`.
- Too much at the top level: hundreds of HTTP tests covering what unit tests could. Push edge cases down a level.
- Serial execution of independent files. Vitest runs files in parallel by default; give them isolated databases so they can.

In CI, split a long suite across machines with `vitest run --shard=1/4` (and `--shard=2/4`, ...). Locally, watch mode reruns only the tests affected by the files you changed.

## What coverage tells you, and what it does not

Coverage tools (`vitest run --coverage` with the `@vitest/coverage-v8` package, or `node --test --experimental-test-coverage`) report which lines, branches and functions ran during the tests.

What it tells you: **code that never ran is untested.** A branch at 0% is a real gap, and the report is a fast way to find error paths nobody exercised.

What it does not tell you: **that the code that ran was checked.** This test covers every success path of `parsePageParams` (from the first task) and catches nothing:

```ts
it('parses', () => {
  parsePageParams({ limit: '5', offset: '0', sort: '-title' });
  parsePageParams({});
});
```

Coverage counts execution, not assertions. It also cannot tell you about code that is missing: if nobody wrote the check for `offset > 10000`, there is no line left uncovered to warn you.

Use coverage as a map of gaps, not as a score. Branch coverage is more useful than line coverage. A threshold in CI works as a floor that stops a gap from growing, not as a target to optimise; teams that chase 100% write tests like the one above.

To measure whether the tests would actually catch bugs, use **mutation testing**: a tool (StrykerJS for JavaScript and TypeScript) makes small changes to your code, such as `>` to `>=`, and reruns the tests. Each change that no test notices points at a missing assertion. It is slow, so teams run it on critical modules or nightly. The first two tasks of this module are checked this way, with hand-picked mutants.

## Tests in CI

A sensible pipeline for a Node backend, cheapest checks first so failures arrive quickly:

```yaml
# .github/workflows/test.yml
name: test
on: [pull_request, push]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 2s
          --health-retries 20
    env:
      DATABASE_URL: postgres://postgres:test@localhost:5432/postgres
      TZ: UTC
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint && npm run typecheck
      - run: npx vitest run --sequence.shuffle --coverage
```

The Postgres service container plays the part Testcontainers plays locally; GitHub's Ubuntu runners have Docker, so Testcontainers itself also works there. Whichever you choose, use the same Postgres major version as production.

Other habits worth keeping: fail the build on a stray `.only` (Vitest does this when it detects CI), upload the coverage and test reports as artifacts, and print the shuffle seed so a failing order can be reproduced. Module 14 builds the full pipeline.

## Common mistakes

- Auto-retrying the whole suite to make CI green.
- `sleep()` in tests to wait for asynchronous work.
- Treating a coverage percentage as proof that the code is tested.
- Asserting on `new Date()` or `Date.now()` taken inside the test.
- Running CI with a different Postgres version, or in a different time zone, than production.
- Leaving a quarantined test skipped forever with no owner.

## Go deeper

- [Martin Fowler: Eradicating Non-Determinism in Tests](https://martinfowler.com/articles/nonDeterminism.html): the causes of flaky tests and how to remove them.
- [Vitest: Coverage](https://vitest.dev/guide/coverage): providers, reports and thresholds.
- [Node.js: Test runner](https://nodejs.org/api/test.html#randomizing-tests-execution-order): randomised order, seeds and coverage in `node:test`.
- [Vitest: Improving performance](https://vitest.dev/guide/improving-performance): pools, isolation and sharding.
