---
title: "Monolith, modular monolith and services"
skills: [sd-service-boundaries]
---

"Should this be a microservice?" comes up in every design review sooner or later. The honest answer for a small team is almost always "not yet, but draw the boundary now". This lesson explains the three shapes, how to draw module boundaries inside one NestJS app so that the code stays changeable, which signals make a separate service worth its cost, and how teams actually move a module out when the time comes.

## Three shapes

- **Monolith:** one deployable, one database, and code where anything can call anything. Fast to start. Over time, every change touches everything, because nothing stops `BillingService` from querying the `documents` table directly.
- **Modular monolith:** still one deployable and one database, but the code is split into modules by business capability, each with a small public interface and its own tables. Modules call each other through that interface, in process.
- **Services:** separate deployables, each with its own data store, talking over the network.

A frontend analogy: a modular monolith is a single React app with feature folders that only import each other's `index.ts`. Microservices are micro-frontends: real independence, paid for with build tooling, version skew and runtime integration problems.

## What a network boundary costs

Moving a call from in-process to over the network changes its nature:

- It can **fail or time out**, so you need timeouts, retries and idempotency (module 8) where you had a function call.
- **Transactions stop at the boundary.** "Create the subscription and grant the entitlement" is no longer one commit; you need an outbox, events or a saga.
- **Deploys must stay compatible.** Version 41 of one service talks to version 42 of the other during every rollout.
- **Debugging needs distributed tracing** (module 12) to follow one request.
- **Local development** needs several processes and their databases.
- **Data gets duplicated** between services, with all the consistency questions from lesson 2.

For a team of five, those costs land on the same five people who are also building the product. That is why "monolith first" is the standard advice.

## Drawing module boundaries in NestJS

Draw boundaries around **business capabilities**, not technical layers. For a SaaS that stores documents for teams:

```text
src/modules/
  identity/      users, sessions, workspaces, memberships, roles
  billing/       plans, Stripe customers, subscriptions, entitlements
  documents/     uploads, files, processing status
  notifications/ email, in-app notifications, digests
  audit/         audit log
```

Not `controllers/`, `services/`, `repositories/`: those cut every feature into three places and every change touches all of them.

Rules that keep the boundaries real:

1. **Each module owns its tables.** Only `billing` reads and writes `subscriptions`. Other modules ask `billing`.
2. **Each module exports a small facade.** Nest modules encapsulate providers by default; only what is listed in `exports` can be injected elsewhere.
3. **No reaching into another module's internals.** Import only from its public entry file.
4. **Cross-module side effects go through events** (often the outbox), so `documents` does not need to know that `notifications` exists.

```ts
// src/modules/billing/billing.module.ts
import { Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

@Module({
  controllers: [StripeWebhookController],
  providers: [EntitlementsService, SubscriptionsRepository],
  exports: [EntitlementsService], // the only thing other modules may use
})
export class BillingModule {}
```

`src/modules/billing/index.ts` re-exports `BillingModule` and `EntitlementsService` and nothing else. That file is the module's public entry.

```ts
// src/modules/documents/documents.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { EntitlementsService } from '../billing/index.js';

@Injectable()
export class DocumentsService {
  constructor(private readonly entitlements: EntitlementsService) {}

  async requestUpload(workspaceId: string, sizeBytes: number) {
    const limits = await this.entitlements.limitsFor(workspaceId);
    if (sizeBytes > limits.maxFileBytes) throw new ForbiddenException('File too large for your plan');
    // ...
  }
}
```

`DocumentsService` knows that a workspace has limits. It does not know about Stripe, price ids or the `subscriptions` table. If billing later moves to another provider, or to another service, `documents` does not change.

Enforce the import rule mechanically, because good intentions erode under deadlines: an ESLint `no-restricted-imports` pattern that forbids `modules/*/` paths other than each module's `index`, or a dependency-graph tool such as dependency-cruiser in CI. A circular dependency between two modules (module 2) usually means the boundary is in the wrong place.

**The database stays shared but partitioned by ownership.** One Postgres instance, and either a Postgres schema per module (`billing.subscriptions`, `documents.files`) or a table prefix. Avoid joins across module tables in application code; when a report really needs one, use a read-only view owned by the module that exposes it.

## A first, cheap split: the worker

Before any service split, most products split **processes**: the same codebase starts either as an API (`node dist/main.js`) or as a worker (`node dist/worker.js`). They scale separately, a CPU-heavy job cannot slow the API, and you deploy them together from one image. You get most of the operational benefit of services with none of the data problems.

## When a separate service pays off

Split a module out when one or more of these is true and measured, not imagined:

- **A very different resource profile.** PDF rendering or video processing needs lots of CPU and memory, bursts, and could crash the API. (A separate worker process often already solves this.)
- **A different runtime.** An ML model served from Python.
- **A security or compliance boundary.** Card data handling, or a component that must run with different credentials and a smaller blast radius.
- **Independent teams.** Two teams that block each other's deploys every week. Service boundaries tend to mirror team boundaries (Conway's law), so the split follows the organisation.
- **Different availability needs.** The public status page must stay up when the main app is down.

Weak reasons: "the code is messy" (fix the module boundaries), "it will scale better" (stateless monoliths scale horizontally fine), "it is modern".

## How teams actually migrate

When a split is justified, the safe path is gradual. The **strangler fig** pattern:

1. **Make the module clean inside the monolith first.** Facade only, owns its tables, side effects through events. This is most of the work, and it is useful even if you never split.
2. **Stand up the new service** behind the same interface. Inside the monolith, the facade's implementation becomes an HTTP or queue client.
3. **Route traffic gradually,** for example by tenant or by percentage behind a feature flag, comparing results where possible.
4. **Move the data,** the hard part: copy the tables to the new store, keep them in sync (events or change data capture), switch reads, switch writes, then stop syncing.
5. **Delete the old code and tables.** Until you do, you have two systems to run.

Each step is deployable and reversible on its own. A "big bang" rewrite that replaces the monolith in one go is the version that fails.

## Common mistakes

- Starting with microservices before the domain is understood, so the boundaries are wrong and expensive to move.
- Modules split by technical layer instead of business capability.
- One module writing another module's tables "just this once".
- Splitting a service but keeping a shared database that both write: all the costs of services, none of the independence.
- Calling a service synchronously in a chain, so availability multiplies down (lesson 5).

## Go deeper

- [NestJS: Modules](https://docs.nestjs.com/modules): encapsulation and `exports` as a module's public interface.
- [Martin Fowler: Monolith First](https://martinfowler.com/bliki/MonolithFirst.html): why to start with one deployable.
- [Martin Fowler: Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html): replacing a system piece by piece.
- [Shopify Engineering: Deconstructing the Monolith](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity): a modular monolith at large scale.
