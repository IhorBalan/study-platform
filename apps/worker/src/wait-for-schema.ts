/** PostgreSQL codes for "this table does not exist" and "this column does not exist". */
const NOT_MIGRATED = new Set(['42P01', '42703']);

function postgresCode(error: unknown): string | undefined {
  // The query builder wraps the driver's error, so the code can sit on the cause.
  for (let e = error, depth = 0; e && typeof e === 'object' && depth < 4; depth += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The tables never appeared. The message is written for the learner, not for a stack trace. */
export class NotMigratedError extends Error {
  constructor(waitedMs: number, options?: ErrorOptions) {
    super(
      `The database still has no tables after ${Math.round(waitedMs / 1000)} seconds. ` +
        'The API creates them when it starts: check its output for an error, then restart "pnpm dev".',
      options,
    );
    this.name = 'NotMigratedError';
  }
}

export interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onWaiting?: () => void;
}

/**
 * Runs `work`, and tries again while the database is not migrated yet.
 *
 * The API applies the migrations when it starts. In `pnpm dev` the worker
 * starts at the same moment, so on a new install its first query can arrive
 * before the tables exist. Any other error, and a database that never gets
 * its tables, still stops the worker: the latter with a NotMigratedError.
 */
export async function onceMigrated<T>(
  work: () => Promise<T>,
  options: WaitOptions = {},
): Promise<T> {
  const {
    intervalMs = 1000,
    timeoutMs = 120_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onWaiting,
  } = options;
  let waited = 0;
  for (;;) {
    try {
      return await work();
    } catch (error) {
      const code = postgresCode(error);
      if (!code || !NOT_MIGRATED.has(code)) throw error;
      if (waited >= timeoutMs) throw new NotMigratedError(timeoutMs, { cause: error });
      if (waited === 0) onWaiting?.();
      await sleep(intervalMs);
      waited += intervalMs;
    }
  }
}
