import { createHmac, timingSafeEqual } from 'node:crypto';

// A learning exercise: this is what a JWT library does for HS256. In a real
// project use a maintained library such as `jose`, which also handles key
// rotation, asymmetric algorithms, JWKS and the edge cases found since.

const HEADER = { alg: 'HS256', typ: 'JWT' };
const MIN_SECRET_BYTES = 32;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

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

function secretKey(secret) {
  const key = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret;
  if (!Buffer.isBuffer(key) || key.length < MIN_SECRET_BYTES) {
    throw new RangeError(`secret must be at least ${MIN_SECRET_BYTES} bytes`);
  }
  return key;
}

const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const sign = (key, input) => createHmac('sha256', key).update(input).digest();
const nowSeconds = () => Math.floor(Date.now() / 1000);

function decodeJson(segment, what) {
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new TokenError('malformed', `${what} is not a base64url JSON object`);
  }
}

export function issueToken(claims, { secret, expiresInSeconds, audience, now = nowSeconds() }) {
  const key = secretKey(secret);
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new RangeError('expiresInSeconds must be a positive integer');
  }
  const payload = { ...claims, iat: now, exp: now + expiresInSeconds };
  if (audience !== undefined) payload.aud = audience;
  const input = `${encode(HEADER)}.${encode(payload)}`;
  return `${input}.${sign(key, input).toString('base64url')}`;
}

export function verifyToken(token, { secret, audience, now = nowSeconds() }) {
  const key = secretKey(secret);
  if (typeof token !== 'string') throw new TokenError('malformed', 'token must be a string');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((part) => SEGMENT.test(part))) {
    throw new TokenError('malformed', 'expected three base64url segments');
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  // 1. The algorithm is ours to decide, never the token's. Anything but HS256 is refused.
  const header = decodeJson(headerPart, 'header');
  if (header.alg !== 'HS256') throw new TokenError('unsupported-alg', 'only HS256 is accepted');

  // 2. Signature before we trust a single claim.
  const expected = sign(key, `${headerPart}.${payloadPart}`);
  const given = Buffer.from(signaturePart, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new TokenError('bad-signature', 'signature does not match');
  }

  // 3. Claims.
  const payload = decodeJson(payloadPart, 'payload');
  if (!Number.isInteger(payload.exp)) throw new TokenError('malformed', 'exp claim is required');
  if (now >= payload.exp) throw new TokenError('expired', 'token has expired');
  if (audience !== undefined && payload.aud !== audience) {
    throw new TokenError('wrong-audience', 'token was issued for another audience');
  }
  return payload;
}
