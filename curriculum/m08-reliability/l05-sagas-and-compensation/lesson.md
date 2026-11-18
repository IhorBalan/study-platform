---
title: Sagas and compensation
skills: [sagas]
---

Checkout touches three things: reserve stock, charge the card, book the courier. If all three lived in one Postgres database, one transaction would make them all-or-nothing. They do not: the card is at a payment provider and the courier has its own API. When the third step fails, the first two have already happened, and no rollback reaches them. A **saga** is the pattern for this: a sequence of steps, each committed on its own, with a **compensating action** for each step that undoes its effect if a later step fails.

## First: do you need one?

Most small backends need far fewer sagas than conference talks suggest. If the steps write to tables in the same database, use a transaction. That is true even when the code is split into modules or "services" inside one deployable: module boundaries do not need network boundaries. Splitting one database into several and then rebuilding atomicity with sagas is expensive, and a frequent design-interview trap.

You need a saga when a business operation spans systems you cannot put in one transaction:

- your database plus an external API (payments, shipping, email),
- several services that each own their database,
- a long-running process measured in minutes or days (an approval, a delivery), where holding a transaction open is out of the question.

## Compensation is a semantic undo

A rollback erases a change as if it never happened. A compensation is a new action that **counteracts** a change that did happen and was possibly seen:

| Step | Compensation |
| --- | --- |
| Reserve 2 units of stock | Release the reservation |
| Charge 49.00 EUR | Refund 49.00 EUR (the charge stays on the statement) |
| Book a courier | Cancel the booking (maybe with a fee) |
| Send "your order is confirmed" | Send "sorry, your order was cancelled" |

Three consequences follow.

**Some steps cannot be compensated.** An email cannot be unsent, and a shipped parcel cannot be un-shipped. Order the steps so those come **last**, after every step that might fail. The step after which the saga will only move forward is often called the **pivot**: before it, failures compensate backwards; after it, failures are retried until they succeed.

**Compensations must succeed eventually.** A refund that fails cannot be followed by "compensate the compensation". Compensations are retried, with backoff, until they work, and they must be idempotent so that retries are safe (lesson 3). If one truly cannot succeed, it goes to a person: a dead-letter queue and an alert.

**Other requests see the intermediate states.** A saga gives you atomicity eventually, but no isolation. Between "stock reserved" and "payment failed", another customer may see the product as sold out. The usual answer is a **semantic lock**: model the in-between state explicitly (`order.status = 'pending_payment'`) so the rest of the system treats it as provisional, and does not, for example, ship it or count it in revenue.

## Orchestration vs choreography

There are two ways to run the steps.

**Orchestration.** One component, the orchestrator, knows the whole sequence. It calls each step, records progress, and on failure runs the compensations in reverse. The flow is in one place, easy to read and to test, and the current state of every checkout is a row you can query.

**Choreography.** No one is in charge. Each service reacts to events and emits its own: `order.placed` makes inventory reserve stock and emit `stock.reserved`, which makes payments charge and emit `payment.failed`, which makes inventory release the stock. Services stay decoupled, but the flow exists only as the sum of the subscriptions. With more than three or four steps it becomes hard to see, hard to change and hard to debug.

A reasonable default for a small team: orchestrate. Choreography fits when separate teams own the services and the flow is short.

## An orchestrator with persisted state

The orchestrator itself can crash halfway, so its progress must live in the database, not in local variables. Record each step **before** the next one starts, and make the whole thing resumable:

```sql
create table checkouts (
  id          uuid        primary key,
  status      text        not null default 'started',
  -- started -> stock_reserved -> paid -> booked -> completed
  --         or ... -> compensating -> cancelled
  charge_id   text,
  error       text,
  updated_at  timestamptz not null default now()
);
```

```ts
type Step = {
  name: string;
  run: (c: Checkout) => Promise<Partial<Checkout>>;
  compensate: (c: Checkout) => Promise<void>;
};

const steps: Step[] = [
  { name: 'stock_reserved', run: reserveStock, compensate: releaseStock },
  { name: 'paid', run: chargeCard, compensate: refundCard },
  { name: 'booked', run: bookCourier, compensate: cancelCourier },
];

export async function runCheckout(id: string): Promise<void> {
  let checkout = await load(id);
  const done = steps.findIndex((s) => s.name === checkout.status) + 1; // resume after the last step that finished
  for (let i = done; i < steps.length; i++) {
    try {
      const changes = await steps[i].run(checkout);         // each run is idempotent, keyed by checkout id
      checkout = await save(id, { ...changes, status: steps[i].name });
    } catch (error) {
      await save(id, { status: 'compensating', error: String(error) });
      for (let j = i - 1; j >= 0; j--) await retryForever(() => steps[j].compensate(checkout));
      await save(id, { status: 'cancelled' });
      return;
    }
  }
  await save(id, { status: 'completed' });
}
```

The details carry the reliability:

- Every `run` is idempotent with a key derived from the checkout id, so resuming after a crash repeats the last step safely.
- The status is saved after each step, so a worker that picks up a crashed checkout knows where it stopped. A sweeper job finds checkouts stuck in a non-final status for too long and runs them again. (A checkout found in `compensating` should go straight back to the compensation loop; the sketch leaves that branch out.)
- Should the step that failed be compensated too? If it failed with an unknown outcome (a timeout during the charge), yes, because it may have happened. Compensations must therefore accept "there was nothing to undo".
- `retryForever` is a figure of speech: retry with backoff, and after a limit alert a human, leaving the status at `compensating`.

Writing this by hand is fine for one or two flows. When you have many, long waits, or timers ("cancel if not paid within 30 minutes"), a durable workflow engine such as Temporal or a hosted one such as Inngest stores the progress for you. Module 7 compares them.

## Sagas vs distributed transactions

Two-phase commit (2PC) makes several resources commit atomically: a coordinator asks each one to prepare, then tells all to commit. It gives real atomicity and isolation, but every participant holds locks until the coordinator decides, a coordinator failure can leave them stuck, and almost no HTTP API or message broker you would use from Node supports it. Postgres has `PREPARE TRANSACTION`, and its documentation warns that it is meant for transaction managers, not applications.

A saga trades isolation for availability: each step commits immediately and holds nothing, and the system is consistent once the saga finishes or compensates. That trade is the right one almost every time a third-party API is involved.

## Common mistakes

- Building a saga where a single database transaction would do.
- Putting an irreversible step (email, shipment) before a step that may still fail.
- Compensations that are not idempotent, or that give up after one attempt.
- Keeping saga progress in memory, so a crash forgets where it stopped.
- Showing intermediate states as final, for example counting a `pending_payment` order as a sale.
- Long choreographed chains nobody can draw on a whiteboard.

## Go deeper

- [microservices.io: Saga](https://microservices.io/patterns/data/saga.html): orchestration and choreography with examples.
- [Azure Architecture Center: Saga pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga): pivot transactions and the isolation problem.
- [Azure Architecture Center: Compensating Transaction pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction): designing undo steps that can be retried.
- [PostgreSQL: PREPARE TRANSACTION](https://www.postgresql.org/docs/current/sql-prepare-transaction.html): two-phase commit in Postgres, and why applications should not use it directly.
