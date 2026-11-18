// fetchWithRetry: per-attempt timeouts, an overall deadline, full-jitter backoff and a retry policy.
// Node runs this file directly by stripping the types, so only erasable TypeScript is used.

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

export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

/** Full jitter: a random wait between 0 and min(max, base * 2^(retry - 1)). `retry` is 1 for the first retry. */
export function backoffDelay(retry: number, options: BackoffOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const max = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** (retry - 1));
  return Math.floor(random() * ceiling);
}

/** A request may be repeated if its method is idempotent or it carries an Idempotency-Key. */
export function canRetry(init: RequestInit = {}): boolean {
  const method = (init.method ?? 'GET').toUpperCase();
  return IDEMPOTENT_METHODS.has(method) || new Headers(init.headers).has('idempotency-key');
}

/** Network failures and our own attempt timeout are transient; anything else (a bug, an abort) is not. */
function isTransientError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
}

/** Retry-After in delta-seconds, as milliseconds. The HTTP-date form is ignored. */
function retryAfterMs(res: Response): number | undefined {
  const value = res.headers.get('retry-after');
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim()) * 1000;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchWithRetry(url: string | URL, init: RequestInit = {}, options: RetryOptions = {}): Promise<Response> {
  const retries = canRetry(init) ? (options.retries ?? DEFAULTS.retries) : 0;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULTS.attemptTimeoutMs;
  const deadlineMs = options.deadlineMs ?? DEFAULTS.deadlineMs;
  const startedAt = Date.now();

  // One signal for the whole call: the deadline, or the caller giving up, whichever comes first.
  const deadline = AbortSignal.timeout(deadlineMs);
  const whole = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;

  for (let attempt = 0; ; attempt++) {
    if (whole.aborted) throw whole.reason;
    let wait: number;
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.any([whole, AbortSignal.timeout(attemptTimeoutMs)]) });
      if (!RETRYABLE_STATUS.has(res.status) || attempt >= retries) return res;

      wait = backoffDelay(attempt + 1, options);
      const serverWait = res.status === 429 || res.status === 503 ? retryAfterMs(res) : undefined;
      if (serverWait !== undefined) {
        // The server said when to come back. If that is past our deadline, hand its answer to the caller now.
        if (Date.now() - startedAt + serverWait >= deadlineMs) return res;
        wait = serverWait;
      }
      await res.body?.cancel(); // free the connection; nobody will read this body
    } catch (error) {
      if (whole.aborted) throw whole.reason; // deadline passed or caller cancelled: stop for good
      if (!isTransientError(error) || attempt >= retries) throw error;
      wait = backoffDelay(attempt + 1, options);
    }
    await sleep(wait, whole);
  }
}
