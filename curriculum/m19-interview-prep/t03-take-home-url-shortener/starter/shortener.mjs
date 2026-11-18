// Core of the link shortener: validation, codes, rate limiting and counters.
// Keep HTTP out of this file so every rule can be tested with a fake clock.

export class ValidationError extends Error {
  name = 'ValidationError';
}

export class ConflictError extends Error {
  name = 'ConflictError';
}

export class RateLimitError extends Error {
  name = 'RateLimitError';
  constructor(message, retryAfterSeconds) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const DEFAULT_RATE_LIMIT = Object.freeze({ capacity: 10, refillPerSecond: 1 });

export function createShortener({ clock = Date.now, rateLimit = DEFAULT_RATE_LIMIT } = {}) {
  /**
   * Returns { code, url }. See task.md for the rules.
   * @param {unknown} url
   * @param {{ clientId?: string, alias?: string }} [options]
   */
  function shorten(url, { clientId, alias } = {}) {
    // TODO: validate clientId, take a token from the client's bucket, validate url and alias,
    // pick a unique code, store the link.
    throw new Error('not implemented');
  }

  /** Returns the target url and counts a hit, or null for an unknown code. */
  function resolve(code) {
    // TODO
    throw new Error('not implemented');
  }

  /** Returns { code, url, hits, createdAt } or null. */
  function stats(code) {
    // TODO
    throw new Error('not implemented');
  }

  return { shorten, resolve, stats };
}
