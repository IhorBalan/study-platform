/**
 * Maps `items` through `fn` with at most `limit` calls in flight.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit positive integer
 * @param {(item: T, index: number) => R | Promise<R>} fn
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<R[]>} results in input order
 */
export async function mapLimit(items, limit, fn, options = {}) {
  const { signal } = options;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a positive integer, got ${String(limit)}`);
  }
  signal?.throwIfAborted();

  const results = new Array(items.length);

  return new Promise((resolve, reject) => {
    let next = 0; // index of the next item that has not started
    let inFlight = 0;
    let settled = false;

    // The only place where the outer promise settles and scheduling stops.
    function settle(finish, value) {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      finish(value);
    }

    function onAbort() {
      settle(reject, signal.reason);
    }

    function fillSlots() {
      if (settled) return;
      if (next === items.length && inFlight === 0) {
        settle(resolve, results);
        return;
      }
      while (!settled && inFlight < limit && next < items.length) {
        const index = next++;
        inFlight += 1;
        // The executor catches a synchronous throw from fn and turns it into a rejection.
        new Promise((done) => done(fn(items[index], index))).then(
          (value) => {
            inFlight -= 1;
            results[index] = value;
            fillSlots();
          },
          (error) => {
            // After the first failure this is a no-op, which also means that
            // late failures of in-flight calls are handled, not unhandled.
            inFlight -= 1;
            settle(reject, error);
          },
        );
      }
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    fillSlots();
  });
}
