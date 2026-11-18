// fetchWithRetry: per-attempt timeouts, an overall deadline, full-jitter backoff and a retry policy.
// Node runs this file directly by stripping the types, so use only erasable TypeScript
// (no enums, namespaces or constructor parameter properties).

export interface RetryOptions {
  /** Retries after the first attempt. */
  retries?: number;
  /** Time limit for one attempt, until the response headers arrive. */
  attemptTimeoutMs?: number;
  /** Time limit for the whole call, attempts and waits included. */
  deadlineMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Cancels the whole call. */
  signal?: AbortSignal;
  /** Source of randomness for jitter. Tests pass a fixed function. */
  random?: () => number;
}

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
}

export const DEFAULTS = {
  retries: 3,
  attemptTimeoutMs: 2_000,
  deadlineMs: 10_000,
  baseDelayMs: 100,
  maxDelayMs: 2_000,
} as const;

/** Full jitter: a random wait between 0 and min(max, base * 2^(retry - 1)). `retry` is 1 for the first retry. */
export function backoffDelay(retry: number, options: BackoffOptions = {}): number {
  // TODO: implement full jitter as described in task.md.
  return 0;
}

export async function fetchWithRetry(url: string | URL, init: RequestInit = {}, options: RetryOptions = {}): Promise<Response> {
  // TODO: attempt timeouts, the deadline, the retry policy, backoff, Retry-After and cancellation.
  // Today this is a plain fetch: no timeout, no retries.
  return fetch(url, init);
}
