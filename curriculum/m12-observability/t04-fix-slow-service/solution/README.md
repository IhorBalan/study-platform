# Product service

## Diagnosis

### Slow related-products pages

**Measured.** With a loop of `curl localhost:3000/products/$RANDOM/related` in two terminals, `GET /health` took 150 to 400 ms. A `monitorEventLoopDelay` histogram printed every second showed a p99 of about 200 ms, and 1.5 s of blocking for 15 requests.

**Profiled.** `node --cpu-prof start.mjs`, the same traffic for 20 seconds, Ctrl+C (`start.mjs` turns `SIGINT` into a normal exit, which `--cpu-prof` needs to write its file), and the `.cpuprofile` opened in Chrome DevTools. Bottom-up view: about 85% of the time in `Array.prototype.sort` → `byRatingThenName` → `String.prototype.localeCompare`, called from `relatedProducts`.

**Cause.** `relatedProducts` copies and sorts all 100,000 products on every request, synchronously, to pick five. The ranking is the same for every request.

**Fix.** Sort once at start-up and keep one ranked list per category. A request walks its category's list until it has five others. Start-up takes about 200 ms longer; `/related` now takes well under 1 ms, and the event loop is blocked for a few milliseconds in total under the same load.

### Growing memory

**Measured.** `process.memoryUsage().heapUsed` after `gc()` grew by about 30 MB per 1,000 requests with distinct query strings and never came down.

**Heap snapshots.** `node --inspect start.mjs`, a snapshot, 2,000 requests to `/products/N?utm_campaign=cN`, a second snapshot. The Comparison view showed about 2,000 new `(string)` objects of about 30 kB each. Retainers: `string` ← `Map` entry ← `pageCache` in `server.mjs`.

**Cause.** The page cache was keyed by `req.url`, so every query string made a new entry for the same page, and nothing was ever evicted. Even keyed by id, it could grow to 100,000 pages (about 3 GB).

**Fix.** Key by product id, and bound the cache with a small LRU of 500 pages (about 15 MB), which covers the popular products. Heap growth after 3,000 distinct URLs is now under 5 MB.

## Production signals

- **Event-loop lag:** alert when `nodejs_eventloop_lag_p99_seconds` stays above 100 ms for 10 minutes. It would have fired on the first busy day after the release.
- **Memory:** graph heap used after GC (`nodejs_heap_size_used_bytes`) per instance and alert on a steady climb over hours, before the platform's OOM kill does it for you. Restart counts per deploy are a second, cheaper signal.
