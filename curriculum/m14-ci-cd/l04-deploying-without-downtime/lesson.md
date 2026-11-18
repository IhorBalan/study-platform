---
title: Deploying without downtime
skills: [zero-downtime-deploys]
---

A deploy replaces running processes with new ones. Done naively, that drops the requests in flight, refuses connections while the new process starts, and breaks when old and new code disagree about the database. "Zero downtime" is not one feature you switch on. It is a set of habits: a rollout strategy, health checks the platform can trust, processes that shut down politely, schema changes that work with two versions at once, and a rollback you have practised.

## What goes wrong in a deploy

Four failures cover almost every outage that happens "just because we deployed":

1. **In-flight requests are cut off** when the old process is killed mid-response.
2. **New requests hit a process that is gone or not ready**: the load balancer still routes to a stopped instance, or to a new one that has not connected to the database yet.
3. **Old and new versions are incompatible** while both are running: a renamed column, a changed message format, a removed endpoint the old frontend still calls.
4. **A migration locks a busy table**, and every request waits behind it (module 3, lesson 6).

Each section below removes one of these.

## Rollout strategies

| Strategy | How it works | Rollback | Cost |
| --- | --- | --- | --- |
| Recreate | Stop all old, start all new | Redeploy old | Downtime by design |
| Rolling | Replace instances a few at a time | Roll the old version back in, also gradually | Old and new run side by side |
| Blue-green | Start a full new set, switch traffic at once | Switch back, instantly | Double capacity during the switch |
| Canary | Send a small share of traffic to the new version, watch, then continue | Stop and route everything back | Needs good metrics and automation |

**Rolling** is the default on Kubernetes and most platforms. Settings such as Kubernetes' `maxSurge` and `maxUnavailable` decide how many extra or missing instances are allowed while it runs. Its key property is the one people forget: for the length of the rollout, both versions serve traffic and share the database.

**Blue-green** keeps the old set (blue) running untouched while the new set (green) starts and passes its checks, then moves all traffic. Rollback is a switch, as long as the database still suits blue.

**Canary** is a rolling deploy with a pause and a judgement. Send 5 % of traffic to the new version, compare its error rate and latency with the old version for a few minutes, and only then continue. The judgement should be automated: a canary that someone has to remember to watch is just a slow rollout.

## Health checks the platform can trust

The platform only knows what your health endpoints tell it:

- **Readiness**: "send me traffic". A new instance answers `200` only once it can serve: config loaded, database pool connected, warm-up done. A rollout waits for readiness before it removes old instances, so a new version that never becomes ready never takes traffic.
- **Liveness**: "I am not stuck". Failing it gets the process restarted. Keep it trivial; if it checks the database, a database blip restarts every instance at once.

Module 16 covers the Kubernetes probe settings. The idea is the same on a PaaS, which usually has a single health check path that gates each deploy.

## Graceful shutdown

When an instance is replaced, the platform sends a signal, waits for a grace period, then kills the process. Kubernetes and Railway send `SIGTERM`; Fly sends `SIGINT` by default. What your process does in that window decides whether users see errors:

```ts
import http from 'node:http';

let shuttingDown = false;
const server = http.createServer((req, res) => {
  if (req.url === '/healthz/ready') {
    res.writeHead(shuttingDown ? 503 : 200).end();
    return;
  }
  // ... the real routes
  res.end('ok');
});
server.listen(Number(process.env.PORT ?? 3000));

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true; // 1. readiness fails at once
  setTimeout(() => {
    server.close(() => process.exit(0)); // 3. stop accepting, exit once drained
    server.closeIdleConnections();
  }, 5_000); // 2. keep serving while the load balancer notices
  setTimeout(() => process.exit(1), 20_000).unref(); // 4. hard deadline
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

The order matters. The load balancer learns that an instance is going away a little after the signal, so for a few seconds new requests still arrive. Failing readiness and continuing to serve during that delay means none of them is refused. Then `server.close()` stops accepting, requests in flight finish, and the process exits. The deadline guarantees an exit before the platform's own kill, so you control the log line instead of losing it to `SIGKILL`.

Fit the numbers to the platform. Kubernetes waits 30 seconds by default. Fly's default `kill_timeout` is 5 seconds; raise it in `fly.toml` if your requests can take longer. Railway gives the old deployment 0 seconds by default unless you set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`. A graceful shutdown cannot work inside a window that does not exist. Also close what the process owns (database pools, queue workers) after the HTTP server has drained. Task 3 asks you to build this in full, including keep-alive connections.

## Database migrations in a deploy

During a rolling or canary deploy, old and new code run against one database. So every migration must leave a schema that **both** versions can use. That rules out renaming or dropping a column in the same release as the code that stops using it.

The answer is **expand and contract**, from module 3, lesson 6. Spread a breaking change over several deploys, each safe on its own:

1. **Expand**: add the new column, nullable, and an index built `concurrently`. Old code ignores it.
2. **Migrate code**: deploy code that writes both columns and reads the new one with a fallback. Backfill old rows in batches.
3. **Switch**: deploy code that only uses the new column.
4. **Contract**: in a later release, once nothing reads the old column, drop it.

Run migrations as their own pipeline step, before the new code rolls out, with a `lock_timeout` so a blocked `alter table` fails fast instead of queueing every query behind it. If that step fails, the deploy must stop. Platforms build this in: Fly's `release_command` and Railway's pre-deploy command run in a separate one-off container before the new version starts, and a failing command stops the release.

## Rollbacks

Rolling back the **code** is usually fast: deploy the previous image digest again. That is why images are tagged by commit and never overwritten (lesson 3). Two conditions make it safe:

- **The schema still suits the old code.** With expand and contract it does, because each step was compatible with the version before it. A destructive migration breaks this, and then a code rollback makes things worse.
- **The data is still readable.** If the new version wrote data in a new format, the old version must tolerate it.

Rolling back the **schema** is rarely the right move in production. Down migrations are seldom tested, and dropping a column that the new code already wrote to loses data. Prefer **rolling forward**: a quick fix released through the same pipeline. Decide in advance which one you use for which failure, and write it down; at 3 a.m. nobody designs a rollback well.

## Feature flags: deploy is not release

A **feature flag** is a runtime switch around new behaviour. It separates two events that are easy to confuse: **deploying** (new code is running) and **releasing** (users see the change). You can deploy on Tuesday, turn the feature on for staff on Wednesday, for 10 % of users on Thursday, and switch it off in seconds without a deploy if it misbehaves.

```ts
if (await flags.isEnabled('new-checkout', { userId })) {
  return newCheckout(cart);
}
return legacyCheckout(cart);
```

Flags have real costs. Every flag doubles the paths through that code, and both need tests. Old flags turn into dead branches nobody dares delete; give each flag an owner and a removal date. Evaluating flags from a remote service adds a dependency to every request, so cache the rules locally and decide what happens when the service is down. Use flags for risky user-facing changes and kill switches, not for every commit.

## Common mistakes

- A readiness endpoint that returns `200` before the database pool is connected, so the rollout sends traffic to instances that fail.
- Exiting at once on `SIGTERM`, or not handling it at all, so every deploy drops the requests in flight.
- A grace period shorter than the shutdown delay plus the slowest request.
- Renaming or dropping a column in the same release as the code change.
- A migration step whose failure does not stop the deploy.
- Rollback plans that assume the schema can be rolled back too.
- Feature flags that are never removed.

## Go deeper

- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/): rolling updates, `maxSurge`, `maxUnavailable` and rollout history.
- [BlueGreenDeployment (Martin Fowler)](https://martinfowler.com/bliki/BlueGreenDeployment.html) and [CanaryRelease](https://martinfowler.com/bliki/CanaryRelease.html): the two patterns in their original short form.
- [Feature Toggles (Pete Hodgson)](https://martinfowler.com/articles/feature-toggles.html): release, experiment, ops and permission toggles, and how to manage them.
- [Node.js `http` server](https://nodejs.org/api/http.html): `server.close()`, `closeIdleConnections()` and `closeAllConnections()`.
