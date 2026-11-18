import { createHmac, timingSafeEqual } from 'node:crypto';

// A learning exercise: you are writing what a JWT library does for HS256.
// In a real project, use a maintained library such as `jose`.

export class TokenError extends Error {
  /**
   * @param {'malformed' | 'unsupported-alg' | 'bad-signature' | 'expired' | 'wrong-audience'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'TokenError';
    this.code = code;
  }
}

/** JSON value to base64url, as JWTs encode their header and payload. */
const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

/**
 * Issues a token: base64url(header).base64url(payload).base64url(HMAC-SHA256).
 *
 * TODO: refuse a secret shorter than 32 bytes with a RangeError.
 * TODO: header is { alg: 'HS256', typ: 'JWT' }. Payload is the claims plus
 * `iat` (now) and `exp` (now + expiresInSeconds), and `aud` when given.
 * TODO: sign "<header>.<payload>" with createHmac('sha256', secret).
 *
 * @param {Record<string, unknown>} claims
 * @param {{ secret: string | Buffer, expiresInSeconds: number, audience?: string, now?: number }} options
 *   `now` is in seconds since the epoch and defaults to the current time.
 * @returns {string}
 */
export function issueToken(claims, { secret, expiresInSeconds, audience, now = Math.floor(Date.now() / 1000) }) {
  throw new Error('issueToken is not implemented yet');
}

/**
 * Verifies a token and returns its payload, or throws a TokenError.
 *
 * This version only decodes. It believes every token it is given.
 *
 * TODO: refuse a secret shorter than 32 bytes with a RangeError.
 * TODO: 'malformed' for anything that is not three base64url JSON segments.
 * TODO: 'unsupported-alg' unless the header says HS256.
 * TODO: 'bad-signature' unless the HMAC matches, compared with timingSafeEqual.
 * TODO: 'malformed' without an integer exp, 'expired' once now >= exp.
 * TODO: 'wrong-audience' when `audience` is given and the aud claim differs.
 *
 * @param {string} token
 * @param {{ secret: string | Buffer, audience?: string, now?: number }} options
 * @returns {Record<string, unknown>}
 */
export function verifyToken(token, { secret, audience, now = Math.floor(Date.now() / 1000) }) {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
