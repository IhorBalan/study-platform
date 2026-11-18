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
  // TODO: reject with a RangeError unless `limit` is a positive integer.
  // TODO: reject with `options.signal.reason` if the signal is already aborted.
  // TODO: run at most `limit` calls at a time and keep results in input order.
  // TODO: on the first failure or on abort, reject at once and start no further calls.
  throw new Error('mapLimit is not implemented yet');
}
