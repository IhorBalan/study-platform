# mapLimit

Try it with `node demo.mjs`.

## Notes on my solution

`fillSlots` starts items while a slot is free. Every completed call frees its slot and calls
`fillSlots` again, so there is no batching and no timer. All state changes that end the run go
through `settle`, which also removes the abort listener.

**Calls already in flight.** When `mapLimit` rejects, after a failure or an abort, the calls that
have started keep running. A promise cannot be cancelled from outside; `mapLimit` only stops
waiting for them and stops starting new ones. Their results are dropped, and if they fail later
the rejection is swallowed by the handler that is already attached, so nothing is unhandled. Their
side effects still happen.

**Cancelling them too.** Give `fn` a signal: `fn(item, index, signal)`. `mapLimit` would create its
own `AbortController`, abort it on the first failure, and link it to the caller's signal with
`AbortSignal.any`. A cooperative `fn` passes the signal on to `fetch` or a database driver, which
then stops the work.
