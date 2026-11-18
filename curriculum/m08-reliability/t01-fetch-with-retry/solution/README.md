# fetchWithRetry

Node runs the TypeScript directly: `npm test` runs your tests. Nothing to install. If you want type checking in your editor, `npx tsc -p tsconfig.json` checks without emitting.

## Notes on my solution

The policy lives in `RETRYABLE_STATUS`, `canRetry` and `isTransientError`. The judgement call is `500`: it is often a bug that will fail again, but the task asks for it to be retried, and with three retries and a deadline the cost is bounded. In my own services I would retry a `500` once at most.

Signals: the deadline and the caller's signal form one whole-call signal. Each attempt adds its own timeout. When a fetch rejects, the whole-call signal decides: if it aborted, the call is over; otherwise a `TimeoutError` came from the attempt timer and is retried.

A production client would add a retry budget (for example a token bucket shared by all calls to one host) so that an outage does not multiply traffic by four, and a circuit breaker that fails fast while the partner is down.
