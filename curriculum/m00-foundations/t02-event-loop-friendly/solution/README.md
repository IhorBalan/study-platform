# Event-loop-friendly hashing

Run it with `node start.mjs`. The comments in `start.mjs` show how to see the problem with two terminals.

## Notes on my solution

Each `/hash` request runs `iteratedHash` in a worker thread (`hash-worker.mjs`). The main thread
only waits for the worker's message, so it keeps accepting and answering other requests. The hash
function itself is untouched, which makes it easy to trust that results did not change.

Costs: starting a worker takes a few milliseconds and some memory, so tiny jobs get slower, and
nothing limits how many workers run at once. Under real load this needs a fixed-size pool with a
queue; more workers than cores only adds contention.

Chunking the loop with `setImmediate` would need no extra thread and no extra file, and is a good
fit when the work is short or CPU cores are scarce. It still uses the main thread, so two
concurrent hashes halve each other's speed and `/health` latency grows with the chunk size.

If the client disconnects, the worker is terminated instead of finishing work nobody will read.

## Measurements

Method: `curl -w '%{time_total}'` against `/health` in a loop while
`/hash?input=abc&rounds=5000000` runs in another terminal.

- Before: `/health` took as long as the remaining hash time, up to about 3 s.
- After: `/health` stayed at 1–3 ms.
