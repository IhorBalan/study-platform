---
title: "Test doubles: stubs, spies, mocks and fakes"
skills: [test-doubles]
---

A test double stands in for a real dependency during a test, the way a stunt double stands in for an actor. Doubles make tests fast and deterministic, and they let you reach error paths that are hard to trigger for real. Used carelessly, they also produce tests that pass while production is broken. This lesson names the kinds of double, shows when each fits, and makes the case for fakes over mocks in most backend code.

## The vocabulary

The terms come from Gerard Meszaros's *xUnit Test Patterns*, and Martin Fowler popularised them. Tools blur them (`vi.fn()` can be any of the first three), but the ideas are distinct, and interviewers ask about them.

| Double | What it does | You assert on |
| --- | --- | --- |
| **Stub** | Returns canned answers. `now()` always returns 9:00. | The result of the code under test |
| **Spy** | Records how it was called, and may pass through to the real thing. | The recorded calls, after the fact |
| **Mock** | Is set up with expectations about the calls it should receive. | That those calls happened, with these arguments |
| **Fake** | A working, simplified implementation: an in-memory repository, a clock you can advance. | The result and the state, as with the real thing |
| **Dummy** | Fills a parameter that the code never uses. | Nothing |

The split that matters most is between **state verification** and **behaviour verification**. With a stub or a fake you check the outcome: what the function returned, what is stored now. With a spy or a mock you check the interaction: which method was called, with what. Outcome checks survive refactoring. Interaction checks break whenever the call pattern changes, even if the outcome is the same.

## One service, three doubles

A sign-up service with three dependencies: a user store, a mailer and a clock.

```ts
// src/signup.ts
export interface Clock { now(): Date }
export interface Mailer { send(msg: { to: string; subject: string }): Promise<void> }
export interface User { id: string; email: string; createdAt: Date }
export interface UserStore {
  findByEmail(email: string): Promise<User | null>;
  insert(user: Omit<User, 'id'>): Promise<User>;
}

export class EmailTakenError extends Error {}

export class SignupService {
  #users: UserStore;
  #mailer: Mailer;
  #clock: Clock;

  constructor(users: UserStore, mailer: Mailer, clock: Clock) {
    this.#users = users;
    this.#mailer = mailer;
    this.#clock = clock;
  }

  async signUp(rawEmail: string): Promise<User> {
    const email = rawEmail.trim().toLowerCase();
    if (await this.#users.findByEmail(email)) throw new EmailTakenError(email);
    const user = await this.#users.insert({ email, createdAt: this.#clock.now() });
    await this.#mailer.send({ to: email, subject: 'Welcome' });
    return user;
  }
}
```

Each dependency gets the double that fits it:

- **The store gets a fake.** Its behaviour (find what was inserted) is the point, and a few lines of `Map` reproduce it.
- **The clock gets a stub.** One fixed answer is all the test needs.
- **The mailer gets a spy.** Sending the email is an outcome the user cares about, and it leaves no state to inspect. Recording the call is the honest way to check it.

```ts
// src/signup.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailTakenError, SignupService, type User, type UserStore } from './signup.js';

class InMemoryUserStore implements UserStore {
  #rows = new Map<string, User>();
  #nextId = 1;

  async findByEmail(email: string) {
    return [...this.#rows.values()].find((u) => u.email === email) ?? null;
  }

  async insert(user: Omit<User, 'id'>) {
    const row = { ...user, id: String(this.#nextId++) };
    this.#rows.set(row.id, row);
    return row;
  }
}

const NINE_AM = new Date('2026-01-01T09:00:00Z');
let store: InMemoryUserStore;
let mailer: { send: ReturnType<typeof vi.fn> };
let service: SignupService;

beforeEach(() => {
  store = new InMemoryUserStore();
  mailer = { send: vi.fn().mockResolvedValue(undefined) };
  service = new SignupService(store, mailer, { now: () => NINE_AM });
});

describe('signUp', () => {
  it('stores the normalised email with the current time', async () => {
    const user = await service.signUp('  Ada@Example.COM ');
    expect(await store.findByEmail('ada@example.com')).toEqual(user);
    expect(user.createdAt).toEqual(NINE_AM);
  });

  it('sends a welcome email', async () => {
    await service.signUp('ada@example.com');
    expect(mailer.send).toHaveBeenCalledWith({ to: 'ada@example.com', subject: 'Welcome' });
  });

  it('refuses an email that is already taken, whatever its case', async () => {
    await service.signUp('ada@example.com');
    await expect(service.signUp('ADA@example.com')).rejects.toThrow(EmailTakenError);
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });
});
```

Note the third test. With the fake store, "already taken" needs no special set-up: sign up once, then sign up again. The store behaves like a store.

## The same tests, over-mocked

Here is the version you will find in many codebases:

```ts
it('refuses an email that is already taken', async () => {
  const users = {
    findByEmail: vi.fn().mockResolvedValue({ id: '1', email: 'ada@example.com', createdAt: NINE_AM }),
    insert: vi.fn(),
  };
  const service = new SignupService(users, mailer, { now: () => NINE_AM });
  await expect(service.signUp('ADA@example.com')).rejects.toThrow(EmailTakenError);
  expect(users.findByEmail).toHaveBeenCalledWith('ada@example.com');
  expect(users.insert).not.toHaveBeenCalled();
});
```

It passes. Now look at what it really checks. The mock returns a user for *any* email, so the test would still pass if normalisation were deleted. The test hard-codes the call to `findByEmail`, so switching to an `insert ... ON CONFLICT DO NOTHING` (a better design, without the race between check and insert) breaks it even though the behaviour is the same. Every test re-programs the store for its scenario, and the programming drifts away from what a real store does.

That is the cost of over-mocking:

- **Tests pin the implementation.** Refactors break tests without breaking behaviour, so people stop refactoring, or they update the mocks without thinking.
- **Mocks lie.** A mock returns whatever you told it to. If the real dependency changes (a method now returns `undefined` instead of `null`, a query throws on a constraint), every test still passes.
- **Set-up grows.** Each scenario needs its own script of return values, and readers have to simulate the dependency in their head.

## When a fake beats a mock, and when it does not

Prefer a fake when the dependency has **state** that the code reads back: repositories, caches, queues, clocks. A fake is written once, reused by every test, and lets tests check outcomes.

Prefer a spy or a mock when the interaction **is** the outcome and leaves nothing to inspect: an email sent, an event published, a metric incremented. Assert on the call, and keep it loose, with `toHaveBeenCalledWith` on the fields that matter.

Prefer a stub for simple inputs with no behaviour: a config value, a fixed time, an HTTP client that returns one canned response for one error-path test.

Prefer the real thing when it is fast and deterministic: pure functions, value objects, your own small helpers, and often the database (lesson 4). The best double is the one you did not need.

## Keep fakes honest with a contract test

A fake is only useful while it behaves like the real implementation. Write the expectations once, and run them against both:

```ts
// test/user-store.contract.ts
import { expect, it } from 'vitest';
import type { UserStore } from '../src/signup.js';

export function userStoreContract(makeStore: () => Promise<UserStore>) {
  it('finds a user by the exact email it was stored with', async () => {
    const store = await makeStore();
    const user = await store.insert({ email: 'ada@example.com', createdAt: new Date() });
    expect(await store.findByEmail('ada@example.com')).toEqual(user);
  });

  it('returns null for an unknown email', async () => {
    const store = await makeStore();
    expect(await store.findByEmail('nobody@example.com')).toBeNull();
  });
}
```

Call `userStoreContract(() => Promise.resolve(new InMemoryUserStore()))` in one test file and `userStoreContract(() => makePgUserStore())` in an integration test file. If the two drift apart, a contract test fails.

## Getting the double in: injection over module mocking

The examples pass dependencies through the constructor. NestJS does the same through providers, and lesson 5 shows how to swap them in a test. The alternative is `vi.mock('./mailer.js')`, which replaces a whole module for the test file. It works on code that was never designed for testing, which makes it a good first step on legacy code. It also couples the test to file paths and import order, and it hides a dependency that should be visible in the constructor. When you control the code, inject.

A related rule: **do not mock what you do not own.** Mocking the Stripe SDK's methods directly copies Stripe's API into your tests, and you will copy it wrong. Wrap the SDK in a small interface of your own (`PaymentsGateway.refund(orderId, amountCents)`), use a fake of that interface in service tests, and test the real adapter separately against Stripe's test mode or a stub HTTP server.

## Common mistakes

- Mocking the database driver and asserting on SQL strings. Use a real database instead.
- Asserting on every call a mock received, including incidental ones such as logging.
- A fake with hidden smarts (it normalises emails, the real store does not), so the tests pass on behaviour production lacks.
- `vi.mock` on your own modules when constructor injection was available.
- Forgetting `vi.restoreAllMocks()` (or `restoreMocks: true` in the config) after `vi.spyOn`, so a spy leaks into the next test.

## Go deeper

- [Martin Fowler: Test Double](https://martinfowler.com/bliki/TestDouble.html): the short definitions.
- [Martin Fowler: Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html): state versus behaviour verification, at length.
- [Vitest: Mocking](https://vitest.dev/guide/mocking): functions, modules, timers and globals.
- [Node.js: Test runner, mocking](https://nodejs.org/api/test.html#mocking): `mock.fn`, `mock.method` and `mock.timers`.
