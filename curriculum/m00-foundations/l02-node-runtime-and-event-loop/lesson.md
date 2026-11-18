---
title: The Node runtime and the event loop
skills: [node-event-loop, node-cpu-work]
---

A Node server runs all of your JavaScript on one thread. That is the same model as a browser tab, with one large difference: in the browser a long task freezes one user's page, on the server it freezes every request in the process. To write a backend that stays fast under load you need a working picture of what that thread does.

## What Node is

Node is V8 (the JavaScript engine from Chrome) plus libuv (a C library that provides the event loop, non-blocking network I/O and a thread pool) plus the standard library that connects the two. When you call `socket.write` or `fetch`, JavaScript hands the work to the operating system and returns at once. When the OS reports a result, libuv queues a callback, and the loop runs it on the main thread.

## The phases of the loop

Each turn of the loop walks through phases in a fixed order. The ones you need to know:

1. **Timers**: callbacks of `setTimeout` and `setInterval` whose time has come.
2. **Pending callbacks**: a few system-level callbacks deferred from the previous turn.
3. **Poll**: fetch new I/O events and run their callbacks: incoming connections, data on sockets, completed file reads. If nothing else is waiting, the loop sleeps here.
4. **Check**: callbacks of `setImmediate`.
5. **Close callbacks**: for example a socket's `'close'` event.

A timer delay is therefore a minimum, not a promise. The callback runs when the loop next reaches the timers phase and the thread is free.

## Microtasks

Two more queues sit outside the phases: the `process.nextTick` queue and the promise microtask queue (`.then` callbacks and `await` continuations). Node drains both after every single callback, before the loop moves on. The `nextTick` queue goes first inside callbacks and in CommonJS code. In the top-level code of an ES module, promise callbacks run first, because the module itself runs as part of a promise job.

```ts
import { readFile } from 'node:fs';

readFile(import.meta.filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
  Promise.resolve().then(() => console.log('promise'));
  process.nextTick(() => console.log('nextTick'));
});
// nextTick, promise, immediate, timeout
```

The callback runs in the poll phase. When it returns, the microtask queues drain. The check phase comes next, so `immediate` prints before the loop wraps around to timers. Outside an I/O callback the order of `setTimeout(fn, 0)` and `setImmediate(fn)` is not guaranteed.

Because microtasks run to exhaustion, a promise chain that keeps scheduling more microtasks never lets the loop reach the poll phase. `await` on an already resolved value does not yield to I/O.

## Why blocking hurts everyone

While one callback runs, nothing else does: no new connections are accepted, no responses are written, no timers fire. A handler that spends 200 ms in a synchronous loop adds up to 200 ms to every request that arrives in that window, and they queue behind each other. Typical culprits are `JSON.parse` on a large body, `fs.readFileSync` and other `*Sync` calls, synchronous crypto such as `pbkdf2Sync`, a regular expression with catastrophic backtracking, and sorting or mapping over a very large array.

## The thread pool

Not every asynchronous API uses the OS's non-blocking sockets. File system calls, `dns.lookup`, and the asynchronous versions of expensive `crypto` and `zlib` functions run on libuv's thread pool. It has four threads by default; the `UV_THREADPOOL_SIZE` environment variable changes that. These calls do not block the loop, but they do queue behind each other: a fifth concurrent `crypto.pbkdf2` call waits for a free thread. Network I/O does not use the pool.

## Moving CPU work off the loop

- **Chunking**: split the work and yield with `setImmediate` between pieces. The loop gets a turn between chunks. Simple, but total CPU time does not shrink.
- **Worker threads** (`node:worker_threads`): another V8 instance in the same process, with its own event loop. Data is copied by message passing, or shared with `SharedArrayBuffer`. This is the right tool for CPU-heavy JavaScript.
- **Child processes** (`node:child_process`): a separate OS process. Use it to run another program, or when you need full isolation.
- **Cluster** (`node:cluster`): several copies of the whole server sharing one listening port. It spreads requests over cores, but each copy can still block itself. In containers, running more replicas usually replaces it.

## Spotting a blocked loop

Measure how late the loop is. `monitorEventLoopDelay` samples the delay as a histogram:

```ts
import { monitorEventLoopDelay } from 'node:perf_hooks';

const delay = monitorEventLoopDelay({ resolution: 20 });
delay.enable();
setInterval(() => {
  console.log('p99 loop delay (ms):', delay.percentile(99) / 1e6);
  delay.reset();
}, 5000).unref();
```

A healthy server shows a few milliseconds. Tens or hundreds point to synchronous work. `performance.eventLoopUtilization()` reports the share of time the loop was busy rather than idle, which is a better saturation signal than CPU percentage. To find the guilty function, record a CPU profile with `node --cpu-prof` or the inspector.

## Common mistakes

- Assuming `async` makes a function non-blocking. A CPU loop inside an `async` function blocks exactly as before.
- Using `*Sync` APIs inside request handlers. They are fine at start-up, before the server listens.
- Yielding with `await Promise.resolve()` or `process.nextTick` and expecting I/O to run. Only a macrotask such as `setImmediate` lets the loop advance.
- Treating the thread pool as unlimited. Four slow file or DNS operations can stall the fifth.
- Starting a new worker thread for every tiny job. Start-up cost is real; reuse workers through a pool.

## Go deeper

- [The Node.js event loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick): the official walk through each phase, with timers, `setImmediate` and `nextTick` examples.
- [Don't block the event loop (or the worker pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop): which built-in APIs are expensive and how to partition or offload work.
- [Worker threads](https://nodejs.org/api/worker_threads.html): the API for workers, message channels and transferable data.
- [Performance measurement APIs](https://nodejs.org/api/perf_hooks.html): `monitorEventLoopDelay` and `eventLoopUtilization` in detail.
- [libuv design overview](https://docs.libuv.org/en/v1.x/design.html): the loop and the thread pool from libuv's side.
