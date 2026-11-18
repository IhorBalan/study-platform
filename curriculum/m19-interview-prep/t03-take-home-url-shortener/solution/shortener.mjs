// Core of the link shortener: validation, codes, rate limiting and counters.
// No HTTP and no I/O here, so every rule can be tested with a fake clock.
import { randomInt } from 'node:crypto';

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

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 7;
const ALIAS = /^[A-Za-z0-9_-]{4,32}$/;
const MAX_URL_LENGTH = 2048;

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

function validateUrl(url) {
  if (typeof url !== 'string' || url.length === 0) throw new ValidationError('url must be a non-empty string');
  if (url.length > MAX_URL_LENGTH) throw new ValidationError(`url must be at most ${MAX_URL_LENGTH} characters`);
  if (!URL.canParse(url)) throw new ValidationError('url is not a valid absolute URL');
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('url must use http or https');
  }
  if (!parsed.hostname) throw new ValidationError('url must have a host');
}

export function createShortener({ clock = Date.now, rateLimit = DEFAULT_RATE_LIMIT } = {}) {
  const { capacity, refillPerSecond } = rateLimit;
  /** code -> { url, hits, createdAt } */
  const links = new Map();
  /** clientId -> { tokens, updatedAt } */
  const buckets = new Map();

  // Token bucket per client. Every call to shorten takes a token, valid or not,
  // so a client cannot probe the validator for free.
  function takeToken(clientId) {
    const now = clock();
    const bucket = buckets.get(clientId) ?? { tokens: capacity, updatedAt: now };
    const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
    bucket.updatedAt = now;
    buckets.set(clientId, bucket);
    if (bucket.tokens < 1) {
      const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSecond));
      throw new RateLimitError('too many links created, slow down', retryAfterSeconds);
    }
    bucket.tokens -= 1;
  }

  function shorten(url, { clientId, alias } = {}) {
    if (typeof clientId !== 'string' || clientId.length === 0) {
      throw new ValidationError('clientId must be a non-empty string');
    }
    takeToken(clientId);
    validateUrl(url);

    let code;
    if (alias !== undefined) {
      if (typeof alias !== 'string' || !ALIAS.test(alias)) {
        throw new ValidationError('alias must be 4 to 32 letters, digits, "-" or "_"');
      }
      if (links.has(alias)) throw new ConflictError(`alias "${alias}" is taken`);
      code = alias;
    } else {
      do code = randomCode();
      while (links.has(code));
    }

    links.set(code, { url, hits: 0, createdAt: new Date(clock()).toISOString() });
    return { code, url };
  }

  function resolve(code) {
    const link = links.get(code);
    if (!link) return null;
    link.hits += 1;
    return link.url;
  }

  function stats(code) {
    const link = links.get(code);
    if (!link) return null;
    return { code, url: link.url, hits: link.hits, createdAt: link.createdAt };
  }

  return { shorten, resolve, stats };
}
