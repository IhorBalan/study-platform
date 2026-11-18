---
title: Diagnosing a slow or leaking Node process
skills: [node-diagnostics]
---

Sooner or later a dashboard shows latency climbing on every route at once, or memory rising until the platform kills the instance. Logs and traces say *that* it is slow; they rarely say *which line of JavaScript* is to blame. This lesson is the toolkit for that last step: measuring event-loop lag, CPU profiles and flame graphs, heap snapshots, and a method that keeps you from guessing. Module 0 introduced the event loop; here you use it to find real problems.

## First, which kind of slow?

Before opening a profiler, find out what kind of problem you have. Three shapes cover most cases:

| Symptom | Likely cause | Look at |
| --- | --- | --- |
| Every route slows at once, event-loop lag high, CPU near 100% of one core | Synchronous work on the main thread | CPU profile |
| One route or dependency slow, lag normal, CPU low | Waiting: a slow query, a pool with no free connection, a slow API | Traces, pool metrics, the database |
| Memory grows steadily and never returns, GC time rises, eventually a restart | A leak: something keeps references alive | Heap snapshots |

The middle row is the most common in web services, and no Node profiler will find it, because the process is idle while it waits. A trace shows a span waiting on `pg-pool.connect`; the pool gauge shows 10 of 10 in use and 40 waiting. Check this first.

## Event-loop lag

Node runs your JavaScript on one thread. While a handler computes, nothing else runs: no other request, no timer, no health check. **Event-loop lag** (or delay) is how late the loop gets to scheduled work, and it is the most direct sign of blocking.

```ts
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
let lastElu = performance.eventLoopUtilization();

setInterval(() => {
  const elu = performance.eventLoopUtilization(lastElu); // since the last sample
  lastElu = performance.eventLoopUtilization();
  console.log({
    p99Ms: delay.percentile(99) / 1e6, // nanoseconds to milliseconds
    maxMs: delay.max / 1e6,
    busy: elu.utilization, // 0 to 1: share of time the loop was not idle
  });
  delay.reset();
}, 5000).unref();
```

A healthy API shows a p99 of a few milliseconds and utilisation well below 1. Tens of milliseconds mean something blocks; hundreds mean users feel it on every route. prom-client's default metrics export the same numbers (`nodejs_eventloop_lag_p99_seconds`), so you can graph them and alert on them.

## CPU profiles and flame graphs

To find the code that blocks, record a CPU profile. V8 samples the call stack about every millisecond and records which functions were running.

```sh
node --cpu-prof --cpu-prof-dir=./profiles start.mjs
# send realistic traffic for 20 to 30 seconds, then Ctrl+C
# a CPU.<date>.<pid>....cpuprofile file appears in ./profiles
```

Open the file in Chrome DevTools (Performance panel, load profile) or in VS Code, which opens `.cpuprofile` files directly. You get a **flame graph**: the x-axis is the share of samples (time), not a timeline order; the y-axis is the call stack, callers below and callees above (or the reverse, depending on the tool). A wide bar is a function that was on the stack for much of the time. Look for the widest bars under your request handler, and use the "bottom-up" view to see which functions spent the time themselves rather than in their callees.

Without a restart, `node --inspect start.mjs` opens the inspector on `127.0.0.1:9229`. In Chrome, open `chrome://inspect`, attach, and record a profile from the Performance or Memory tab while traffic runs. Never expose the inspector port beyond localhost: it gives full code execution.

Clinic.js packaged this workflow (a "doctor" that classifies the problem, then flame graphs) and you will see it in older guides. It sees few updates now, so check it runs on your Node version; the built-in flags above always do.

## Worked example: a regex that blocks

A blog API validates slugs before saving posts. After a release, p99 latency on *every* route jumps to seconds, while CPU sits at 100% of one core. That pattern says "blocking", so the next step is a profile, not the database.

The bottom-up view puts almost all samples in `RegExp.prototype.test`, called from `validateSlug`:

```ts
const SLUG = /^([a-z0-9]+-?)+$/;
```

The nested quantifiers let the engine split a long run of letters in exponentially many ways before it gives up. On a long input that does *not* match, such as 28 letters followed by `_`, it takes over two seconds on one machine, and each extra character roughly doubles that. Every other request waits. This is **ReDoS**, regular expression denial of service, and anyone who can send a slug can trigger it.

The fix is a pattern without ambiguity, which accepts the same strings and runs in linear time:

```ts
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*-?$/;
```

Confirm with numbers: the same traffic, a new profile without the hot bar, and lag back to single-digit milliseconds. Then add a test with a long hostile input and a length limit on the field.

Other usual suspects in a flame graph: `JSON.parse` or `JSON.stringify` of large payloads, sorting large arrays per request, `*Sync` calls (`readFileSync`, `pbkdf2Sync`, `zlib.gzipSync`), and template rendering. The cures are the ones from module 0: do the work once at start-up, cache it with a bound, stream it, or move it to a worker thread.

## Memory: is it a leak?

Rising memory is not always a leak. V8 grows the heap lazily and collects when it wants to, so a sawtooth that returns to the same floor after each major GC is healthy. A leak is a **floor that keeps rising**: heap used *after* garbage collection grows with traffic and never comes back down.

Watch `process.memoryUsage().heapUsed` (or the `nodejs_heap_size_used_bytes` metric) over hours. If the container limit is close, also watch `rss`, which includes buffers and native memory outside the JavaScript heap.

Common leaks in web services:

- **Unbounded caches**: a `Map` that only grows, often keyed by something unbounded such as the full URL.
- **Listeners added per request** to a long-lived emitter and never removed. Node warns with `MaxListenersExceededWarning` after ten; take that warning seriously.
- **Closures kept by timers** or intervals that are never cleared.
- **Arrays used as logs or queues** that are appended to and never trimmed.

## Heap snapshots

A heap snapshot is a full picture of every object on the JavaScript heap and what references it. The technique is to compare two:

1. Start the process with `--inspect`, attach DevTools, and take a snapshot after warm-up.
2. Send a few thousand requests of the kind you suspect.
3. Take a second snapshot (DevTools forces a GC first).
4. Switch to the **Comparison** view and sort by size delta. Objects that grew by roughly the number of requests are your leak.
5. Select one and read its **Retainers**: the chain of references that keeps it alive, for example `(closure)` ← listener array ← `EventEmitter` ← `orderEvents` in `events.ts`: a handler that every request subscribed and none unsubscribed.

Without DevTools, `node --heapsnapshot-signal=SIGUSR2 start.mjs` writes a snapshot when you send that signal, and `v8.writeHeapSnapshot()` writes one from code. Load the files into DevTools afterwards. Two warnings: taking a snapshot pauses the process and needs memory roughly the size of the heap, so do it on one instance taken out of the load balancer, and snapshots contain everything in memory, including personal data and secrets. Treat them like a database dump.

For a leak that only shows in production, `--heapsnapshot-near-heap-limit=1` writes a snapshot automatically as the heap approaches its limit, just before the crash.

## The method

Whatever the tool, the method is the same:

1. **Reproduce** with numbers: a load script and a baseline measurement of lag, latency or heap.
2. **Classify**: blocking, waiting or leaking.
3. **Measure** with the matching tool: profile, trace, or two snapshots.
4. **Change one thing** and measure again the same way.
5. **Guard** against the return: a test, a limit, a metric and an alert.

Interviewers asking how you would debug a slow Node service want to hear this order. "I would add more logging" is not a method.

## Common mistakes

- Profiling the CPU when the process is idle and waiting on a pool or a dependency.
- Reading a flame graph's x-axis as time order.
- Calling a growing `rss` a leak without looking at heap used after GC.
- Taking a heap snapshot on a production instance that is still serving traffic.
- Leaving `--inspect` reachable from outside the machine.
- Fixing a guess, then not measuring whether it helped.

## Go deeper

- [Node.js: Profiling Node.js applications](https://nodejs.org/en/learn/getting-started/profiling): the built-in profiler and how to read it.
- [Node.js: Diagnostics guides](https://nodejs.org/en/learn/diagnostics/memory): memory issues, heap snapshots and GC tracing.
- [Node.js: perf_hooks](https://nodejs.org/api/perf_hooks.html): `monitorEventLoopDelay` and `eventLoopUtilization`.
- [Chrome DevTools: Record heap snapshots](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots): the Comparison view and retainers.
- [OWASP: Regular expression denial of service](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS): why nested quantifiers explode.
