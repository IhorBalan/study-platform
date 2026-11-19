---
title: Retries done right
skills: [retry-policies]
---

Most failures in a healthy system are brief: a connection reset during a deploy, a pod restarting, a database failover, a rate limit that clears in a second. A retry turns those into a slightly slower success instead of an error page. Done badly, retries do the opposite. They multiply load on a struggling dependency and turn a five-second blip into an hour-long outage. This lesson is about the difference.

## What to retry

A retry is worth it only when two things are true: the failure is likely to be **transient**, and the operation is **safe to repeat**.

Transient failures:

- Network errors: connection refused or reset, DNS failure (`fetch` rejects with a `TypeError`).
- Your own attempt timeout (`TimeoutError`).
- `408 Request Timeout`, `429 Too Many Requests`, `502 Bad Gateway`, `503 Service Unavailable`, `504 Gateway Timeout`.
- `500 Internal Server Error` is a judgement call. It is often a bug that will fail again, but many teams retry it once.
- In Postgres: `40001` serialization failure and `40P01` deadlock, by rerunning the whole transaction (module 3, lesson 5).

Permanent failures, which a retry only repeats: `400`, `401`, `403`, `404`, `409`, `422`, constraint violations, validation errors. Retrying them wastes time and hides the bug.

Safe to repeat means idempotent. `GET`, `HEAD`, `PUT` and `DELETE` are idempotent by definition. A `POST` is safe only when it carries an idempotency key that the server honours (module 4, lesson 3). A retry policy that retries every `POST` on a timeout is how customers get charged twice.

One more rule: **retry at one layer only**. If the browser retries three times, the API gateway three times and your service three times, one failing database call becomes 27 attempts. Pick the layer closest to the failure that knows whether the operation is safe, usually the code that makes the call, and let the others pass errors through.

## Exponential backoff with jitter

Retrying immediately rarely helps: whatever failed has not recovered in a millisecond. Waiting a fixed second is better, but when a dependency blips, every client fails at the same moment and retries at the same moment, a **thundering herd** that knocks it over again.

**Exponential backoff** doubles the wait after each failure: 100 ms, 200 ms, 400 ms, capped at some maximum. **Jitter** adds randomness so clients spread out. The variant with the best measured results in AWS's analysis is **full jitter**: wait a random time between zero and the exponential value.

```ts
export function backoffDelay(retry: number, baseMs = 100, maxMs = 5_000, random = Math.random): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** (retry - 1)); // retry is 1 for the first retry
  return Math.floor(random() * ceiling);
}
// Possible waits: retry 1 -> 0..99 ms, retry 2 -> 0..199 ms, retry 3 -> 0..399 ms
```

Passing `random` in is not decoration. It lets a test pin the value and check the arithmetic, the same trick as injecting the clock in module 5.

When the server tells you how long to wait, believe it. A `429` or `503` may carry `Retry-After`, either as seconds (`Retry-After: 2`) or as an HTTP date. Wait that long instead of your own backoff. If that is longer than your remaining deadline, waiting is pointless: the simple loop below lets the deadline cut the wait short, and a stricter version compares the wait with the time left and fails at once with the status it received.

## A retry loop that respects the deadline

Put the pieces together: an attempt timeout, a list of retryable outcomes, backoff, `Retry-After` and the deadline from lesson 1.

```ts
const RETRY_STATUS = new Set([408, 429, 502, 503, 504]);

export async function getJson(url: string, deadline: AbortSignal, retries = 3): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let wait = backoffDelay(attempt + 1);
    try {
      const res = await fetch(url, { signal: AbortSignal.any([deadline, AbortSignal.timeout(1_000)]) });
      if (res.ok) return await res.json();
      if (!RETRY_STATUS.has(res.status) || attempt === retries) {
        throw new Error(`GET ${url} failed with ${res.status}`);
      }
      wait = retryAfterMs(res) ?? wait;            // the server's own number wins
      await res.body?.cancel();                    // free the connection before waiting
    } catch (error) {
      if (deadline.aborted) throw deadline.reason;  // out of budget: stop
      const transient = error instanceof TypeError || (error as Error).name === 'TimeoutError';
      if (!transient || attempt === retries) throw error;
    }
    await sleep(wait, deadline);
  }
}

/** `Retry-After: 2` (seconds) or an HTTP date. Undefined when absent or unreadable. */
function retryAfterMs(res: Response): number | undefined {
  const value = res.headers.get('retry-after');
  if (!value) return undefined;
  const ms = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}
```

Three details are easy to miss. The response body of a discarded attempt must be consumed or cancelled, or the socket stays busy. The sleep must wake up when the deadline fires, or a cancelled request still waits out its backoff. And the loop must tell its own attempt timeout (`TimeoutError` from the per-call signal, retryable) from the overall deadline (`deadline.aborted`, final).

## Retry budgets

Backoff spaces retries out but does not cap them. If a dependency is down for a minute, every request still makes four attempts, so the dependency sees four times its normal traffic the moment it comes back. A **retry budget** caps retries as a share of traffic: for example, retries may be at most 10% of requests in the last ten seconds. When the budget is spent, fail fast. Under normal conditions nothing changes; during an outage the extra load stays at 10%. AWS SDKs implement a variant with a token bucket that retries draw from and successes refill.

## Circuit breakers

A **circuit breaker** wraps calls to one dependency and tracks recent failures. It has three states:

- **Closed**: calls go through. When failures pass a threshold (say 50% of the last 20 calls), it opens.
- **Open**: calls fail immediately, without touching the network, for a cool-down period.
- **Half-open**: after the cool-down, a few trial calls go through. If they succeed it closes; if not, it opens again.

The point is not to protect your service from errors. It is to stop spending threads, sockets and seconds of user time on calls that will fail anyway, and to give the dependency room to recover. An open breaker should map to something useful: a cached value, a default, a feature switched off, or a clear `503` with `Retry-After`. Libraries such as `opossum` and `cockatiel` implement breakers, retries and timeouts for Node; the concepts matter more than the choice.

Breakers belong around dependencies whose failure you can work around. A breaker in front of your only database just converts one error into another.

## When a dependency is down

This is a classic interview question, and it has a structured answer:

1. **Fail fast**: timeouts so requests do not hang, and a breaker so they stop trying.
2. **Degrade**: serve cached or default data, hide the feature, or accept the work and do it later.
3. **Queue what can wait**: an email, a webhook or a sync can go into a job queue with retries (module 7) and complete when the dependency returns.
4. **Isolate**: give each dependency its own connection pool or concurrency limit (a **bulkhead**), so one slow service cannot use up every connection.
5. **Tell people**: alert on the breaker opening, and return honest errors to clients.

## Load shedding

The mirror image of retrying is refusing work you cannot finish. When a server is overloaded, latency rises, clients time out and retry, and the server spends its time on requests nobody is waiting for any more. **Load shedding** rejects some requests early, with `503` and `Retry-After`, so the rest finish within their deadline. Simple versions limit concurrent requests per instance, or reject requests that have already waited in a queue longer than the client's timeout. A fast "no" is kinder than a slow timeout.

## Common mistakes

- Retrying `400`, `404` or validation errors, which can never succeed.
- Retrying a `POST` without an idempotency key.
- Fixed delays, or exponential backoff without jitter, so clients retry in lockstep.
- Retries at several layers that multiply.
- A backoff sleep that ignores cancellation, or retries that run past the deadline.
- No cap on retries during an outage, so recovery is met with a traffic spike.

## Go deeper

- [AWS Architecture Blog: Exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/): the simulation behind full jitter.
- [Amazon Builders' Library: Timeouts, retries and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/): retry budgets and retrying at one layer.
- [Azure Architecture Center: Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker): states and design considerations.
- [RFC 9110: Retry-After](https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3): both formats of the header.
