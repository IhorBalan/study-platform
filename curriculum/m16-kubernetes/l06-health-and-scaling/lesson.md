---
title: "Health and scaling: probes, graceful shutdown, HPA and PDBs"
skills: [k8s-health-scaling]
---

Kubernetes can only keep your API healthy if your API tells it the truth about its health, and it can only replace Pods without dropping requests if your process shuts down politely. This lesson covers the three probes and what each one should check, the exact sequence when a Pod is stopped and how a Node service should react, and how the cluster adds Pods under load and keeps enough of them during maintenance.

## Three probes, three different questions

The kubelet runs probes against each container. A probe can be an HTTP `GET` (a status from 200 to 399 passes), a TCP connect, a gRPC health check or a command.

| Probe | Question | On failure |
| --- | --- | --- |
| **Readiness** | Should this Pod receive traffic right now? | Removed from the Service's endpoints. **Not restarted.** Added back when it passes again. |
| **Liveness** | Is this process stuck beyond repair? | Container is **killed and restarted**. |
| **Startup** | Has the app finished starting? | Liveness and readiness wait until it passes. If it never does, the container is restarted. |

The difference between readiness and liveness is the most asked Kubernetes interview question for backend developers. Readiness controls **traffic**. Liveness controls **restarts**. A Pod that is busy, warming a cache or briefly cut off from a dependency should become *unready*, not be killed.

### What each probe should check

- **Liveness: only the process itself.** Can the event loop answer an HTTP request? Return 200 from a handler that touches nothing else. **Never check the database here.** If the database has a five-second blip, every Pod fails liveness, every Pod restarts at once, and a small incident becomes an outage with cold starts on top.
- **Readiness: can I serve requests?** Have I finished start-up, connected my pool, loaded what I need? Checking a hard dependency such as the primary database can be reasonable, but think about the failure mode: if the database is down for everyone, all Pods go unready and the Service has no endpoints, so clients get connection errors instead of your clear 503. Many teams check only local state in readiness and let requests fail with good errors.
- **Startup: for slow starters.** If the app needs 40 seconds to boot, a startup probe with a generous budget protects it from liveness while booting, without making liveness slow forever.

```yaml
startupProbe:
  httpGet: { path: /livez, port: http }
  periodSeconds: 2
  failureThreshold: 30          # up to 60 s to start
readinessProbe:
  httpGet: { path: /readyz, port: http }
  periodSeconds: 5
  failureThreshold: 2
livenessProbe:
  httpGet: { path: /livez, port: http }
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3           # 30 s of failures before a restart
```

Defaults if you omit them: `periodSeconds: 10`, `timeoutSeconds: 1`, `failureThreshold: 3`. A one-second timeout is tight for a Node process doing a burst of CPU work, which is another reason to keep the liveness handler trivial.

Without a readiness probe, a Pod counts as ready as soon as its container starts, so a rolling update sends traffic to a Node process that has not yet called `listen()`. Those requests fail.

## What happens when a Pod is stopped

A deploy, a scale-down or a node drain deletes Pods. The sequence:

1. The Pod is marked **terminating**. Two things now start **in parallel**:
   - The EndpointSlice controller removes the Pod from the Service, and that change spreads to every node and every gateway. This takes a moment, from milliseconds to a few seconds.
   - The kubelet runs the container's **`preStop` hook**, if any, and then sends **SIGTERM** to the main process (PID 1 in the container).
2. The process should stop accepting new connections, finish in-flight requests, close pools and exit.
3. If it is still running when **`terminationGracePeriodSeconds`** (default 30, counted from the start, including `preStop`) runs out, the kubelet sends **SIGKILL**.

Because of the race in step 1, a process that closes its server the instant it gets SIGTERM can still receive requests from gateways that have not yet heard it is leaving. Those requests get "connection refused" or a reset. The usual fix is a short `preStop` sleep, so the Pod keeps serving normally while the endpoint removal spreads, and only then gets SIGTERM:

```yaml
spec:
  terminationGracePeriodSeconds: 40
  containers:
    - name: api
      lifecycle:
        preStop:
          sleep:
            seconds: 10
```

The `sleep` action is built in (stable since Kubernetes 1.34), so the image needs no `sleep` binary. On older clusters people used `exec: { command: ["sleep", "10"] }`. Budget the grace period as: preStop sleep plus your slowest normal request plus a margin.

### Graceful shutdown in Node

First, make sure the signal reaches Node. Start it directly in exec form, `CMD ["node", "dist/main.js"]`. A shell form `CMD` or an `npm start` wrapper may not pass SIGTERM on, and then your handler never runs and every shutdown ends in SIGKILL after 30 seconds.

A plain Node server:

```ts
import { createServer } from 'node:http';
import { pool } from './db.js';
import { handler } from './app.js';

const server = createServer(handler);
server.listen(3000, '0.0.0.0');

process.once('SIGTERM', () => {
  console.log('SIGTERM received, draining');
  // Stop accepting connections; the callback runs when in-flight requests finish.
  server.close(async (err) => {
    await pool.end();
    process.exit(err ? 1 : 0);
  });
  // Close idle keep-alive sockets now so they do not hold the server open.
  server.closeIdleConnections();
  // Safety net below the grace period.
  setTimeout(() => process.exit(1), 25_000).unref();
});
```

In NestJS, `enableShutdownHooks()` makes the app listen for termination signals, close the HTTP server and call `beforeApplicationShutdown` and `onApplicationShutdown` hooks in your providers, where you close pools and stop queue workers:

```ts
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
await app.listen(3000, '0.0.0.0');
```

Workers that pull jobs (BullMQ in module 7) need the same care: stop taking new jobs on SIGTERM, finish or release the current one, then exit.

## Scaling

### HorizontalPodAutoscaler

The **HPA** changes a Deployment's `replicas` based on metrics. The common case scales on CPU **as a percentage of the request**, which is why requests matter:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300   # wait 5 minutes of low load before removing Pods
```

Notes:

- Resource metrics come from **metrics-server**, an add-on most managed clusters include.
- **Remove `replicas` from the Deployment manifest** once an HPA owns it. Otherwise every deploy resets the count to the manifest's value and the HPA has to scale up again.
- CPU is a decent signal for a CPU-bound API. For queue workers, scale on queue depth instead; **KEDA** is the common tool for event-driven scaling from Redis, SQS, Kafka and others.
- New Pods need somewhere to run. A **cluster autoscaler** (or Karpenter on AWS) adds nodes when Pods are pending for lack of capacity, which takes a minute or more. Keep `minReplicas` high enough to absorb a spike while that happens.

### PodDisruptionBudgets

Nodes get drained for upgrades and maintenance. Without a limit, a drain can evict all your Pods at once if they happen to share nodes. A **PodDisruptionBudget** caps how many Pods voluntary disruptions may take down at a time:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api
spec:
  minAvailable: 2          # or maxUnavailable: 1
  selector:
    matchLabels:
      app: api
```

A PDB protects against **voluntary** disruptions (drains, cluster upgrades, autoscaler scale-down) that go through the eviction API. It does nothing against a node crashing. For that, run at least two or three replicas spread across nodes and zones with `topologySpreadConstraints`. Do not set `minAvailable` equal to the replica count; then no Pod can ever be evicted and node drains hang.

## Common mistakes

- A liveness probe that checks the database, Redis or another service.
- No readiness probe, so traffic reaches Pods before `listen()`.
- Identical liveness and readiness endpoints with heavy checks.
- `CMD npm start` or a shell-form `CMD`, so SIGTERM never reaches Node.
- No `preStop` delay, causing a burst of failed requests on every deploy.
- A grace period shorter than the slowest request.
- `replicas` in the manifest fighting the HPA.
- A PDB with `minAvailable` equal to `replicas`.

## Go deeper

- [Liveness, readiness and startup probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/): what each probe is for.
- [Configure probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/): every field with examples.
- [Pod lifecycle: termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination): the shutdown sequence in detail.
- [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/): the algorithm, metrics and scaling behaviour.
- [Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/): voluntary and involuntary disruptions and PDBs.
