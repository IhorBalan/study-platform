---
title: "GraphQL, gRPC and tRPC compared with REST"
skills: [api-paradigms]
---

REST is the default for public HTTP APIs, but it is not the only option, and interviewers like to ask when you would choose something else. Each alternative solves a specific problem that REST handles badly, and each brings costs of its own. Knowing the problem each one solves is the whole answer.

## GraphQL: the client chooses the shape

A REST screen that shows a project, its tasks and each task's assignee may need three or more round trips, or one bespoke endpoint that returns exactly that screen's data. GraphQL replaces both with one endpoint and a typed schema; the client sends a query that names the fields it wants:

```graphql
query ProjectPage {
  project(id: "42") {
    name
    tasks(first: 20) {
      title
      assignee { name avatarUrl }
    }
  }
}
```

The response has exactly that shape. For frontend developers this is attractive: one request per screen, no over-fetching, and tools such as GraphQL Code Generator produce TypeScript types for each query.

On the server, every field has a **resolver**, a function that produces its value. `project` is resolved once, `tasks` once per project, and `assignee` once **per task**. That is where the classic problem comes from.

### The N+1 problem and DataLoader

With naive resolvers, the query above runs one query for the project, one for its tasks, and then one `SELECT ... FROM users WHERE id = $1` for each of the 20 tasks: 1 + N queries. A list of 100 posts with authors is 101 round trips to the database.

DataLoader fixes this by batching. Resolvers ask a loader for one key; the loader collects every key requested in the same tick of the event loop and calls your batch function once with all of them:

```ts
import DataLoader from 'dataloader';
import { inArray } from 'drizzle-orm';

export function createUserLoader(db: Db) {
  return new DataLoader<string, User>(async (ids) => {
    const rows = await db.select().from(users).where(inArray(users.id, [...ids]));
    const byId = new Map(rows.map((u) => [u.id, u]));
    // Must return one result per key, in the same order as the keys.
    return ids.map((id) => byId.get(id) ?? new Error(`User ${id} not found`));
  });
}

// resolver for Task.assignee
assignee: (task, _args, ctx) => ctx.loaders.user.load(task.assigneeId),
```

Twenty `load()` calls become one `WHERE id IN (...)` query. DataLoader also caches per key, so the same user requested twice is loaded once. Two rules matter:

- **Create loaders per request.** A loader shared between requests caches one user's view of the data and serves it to another, and never expires.
- **Return results in key order**, with an error (not a missing entry) for keys that were not found.

### What GraphQL costs

- **Caching.** Queries usually go as `POST` to one URL, so HTTP caches and CDNs see nothing they can cache. Persisted queries (a hash instead of the query text, sent with `GET`) help.
- **Cost control.** A client can write a deeply nested query that fans out into millions of rows. You need depth and complexity limits, and pagination on every list field.
- **Errors.** A response commonly comes back as `200` with an `errors` array next to partial `data`. Monitoring that only watches status codes sees nothing.
- **Authorisation per field.** Every resolver is an entry point, so permission checks move from routes into the data layer.

It fits best when many different clients (web, iOS, Android, partners) need different views of a rich, connected data model, and a team can own the schema. NestJS supports it through `@nestjs/graphql` with code-first resolvers and decorators.

## gRPC: fast, typed calls between services

gRPC is a remote procedure call framework. You describe services and messages in a `.proto` file, and code generators produce clients and servers for many languages:

```proto
syntax = "proto3";
package projects.v1;

service Projects {
  rpc GetProject(GetProjectRequest) returns (Project);
  rpc WatchProject(GetProjectRequest) returns (stream ProjectEvent);
}

message GetProjectRequest { string id = 1; }
message Project { string id = 1; string name = 2; }
message ProjectEvent { string project_id = 1; string kind = 2; }
```

Messages travel as Protocol Buffers, a compact binary format, over HTTP/2. The field **numbers**, not the names, identify fields on the wire, which is why you can rename a field safely but must never reuse a number. gRPC also has first-class deadlines (the client says how long it will wait, and the deadline propagates to downstream calls) and four call types: unary, server streaming, client streaming and bidirectional streaming.

The cost: browsers cannot speak native gRPC, because they do not expose the HTTP/2 framing it needs. You need gRPC-Web or the Connect protocol and a proxy or a compatible server. Payloads are not human-readable, so `curl` and browser dev tools are less useful. It fits **internal service-to-service traffic**, especially across languages, high call volumes and streaming. NestJS supports it as a microservice transport.

## tRPC: end-to-end types without a schema

tRPC is TypeScript only. The server defines procedures; the client imports the router's **type** (not its code), and calls the procedures as typed functions:

```ts
// server/router.ts
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();
export const appRouter = t.router({
  projectById: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => projects.find(input.id)),
});
export type AppRouter = typeof appRouter;
```

```ts
// web/api.ts
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../server/router.js';

const trpc = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] });
const project = await trpc.projectById.query({ id: '42' });   // fully typed
```

Rename a field on the server and the frontend fails to compile, with no code generation step. For a full-stack TypeScript monorepo (a Next.js app and its own backend) the developer experience is excellent. The cost is coupling: the client must be TypeScript and must have the server's types at build time. There is no language-neutral contract, so it is a poor fit for public APIs, mobile apps in Swift or Kotlin, or other teams.

## Choosing

| Situation | Good fit |
| --- | --- |
| Public API, many unknown clients, cacheable reads | REST with OpenAPI |
| Several frontends need different views of a connected graph of data | GraphQL |
| Internal calls between services, many languages, streaming, tight latency | gRPC |
| One TypeScript team, frontend and backend in one repo, no outside consumers | tRPC |
| Push updates to browsers | SSE or WebSockets (next lesson), alongside any of the above |

These are not exclusive. A common shape is REST or GraphQL at the edge for browsers and partners, and gRPC or a queue between internal services. Choose by who the clients are and who must agree on the contract, not by fashion.

## Common mistakes

- Adopting GraphQL for a single web client with simple screens, then paying for caching, cost limits and field-level authorisation anyway.
- One global DataLoader, which leaks data between users.
- Calling gRPC services directly from the browser without gRPC-Web or Connect.
- Exposing a tRPC router as a public API.
- Treating a `200` GraphQL response as success without checking `errors`.

## Go deeper

- [GraphQL: Learn](https://graphql.org/learn/): schemas, queries, resolvers and execution.
- [GraphQL.js: solving N+1 with DataLoader](https://www.graphql-js.org/docs/n1-dataloader/): batching and per-request loaders.
- [gRPC: Introduction](https://grpc.io/docs/what-is-grpc/introduction/): services, Protocol Buffers and call types.
- [tRPC documentation](https://trpc.io/docs): routers, procedures and clients.
- [NestJS: GraphQL](https://docs.nestjs.com/graphql/quick-start): code-first and schema-first resolvers in Nest.
