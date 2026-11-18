import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/** OWASP's minimum for scrypt: N = 2^17 (128 MiB with r = 8), r = 8, p = 1. */
export const DEFAULT_PARAMS = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MAX_LENGTH = 1024;
const FORMAT = /^\$scrypt\$n=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function checkPassword(password) {
  if (typeof password !== 'string') throw new TypeError('password must be a string');
  if (password.length === 0 || password.length > MAX_LENGTH) {
    throw new RangeError(`password must have 1 to ${MAX_LENGTH} characters`);
  }
}

/** scrypt needs 128 * N * r bytes. Node refuses anything over `maxmem`, which defaults to 32 MiB. */
function derive(password, salt, { N, r, p }) {
  return scryptAsync(password.normalize('NFC'), salt, KEY_BYTES, {
    N,
    r,
    p,
    maxmem: 128 * N * r + 1024 * 1024,
  });
}

/** Parses a stored hash. Returns null for anything that is not in our format. */
function parse(stored) {
  if (typeof stored !== 'string') return null;
  const match = FORMAT.exec(stored);
  if (!match) return null;
  const [N, r, p] = match.slice(1, 4).map(Number);
  // Refuse absurd values, so a corrupted or planted row cannot make us allocate gigabytes.
  const powerOfTwo = N > 1 && (N & (N - 1)) === 0;
  if (!powerOfTwo || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  const salt = Buffer.from(match[4], 'base64url');
  const hash = Buffer.from(match[5], 'base64url');
  if (salt.length !== SALT_BYTES || hash.length !== KEY_BYTES) return null;
  return { params: { N, r, p }, salt, hash };
}

export async function hashPassword(password, params = DEFAULT_PARAMS) {
  checkPassword(password);
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, params);
  const { N, r, p } = params;
  return `$scrypt$n=${N},r=${r},p=${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  try {
    checkPassword(password);
  } catch {
    return false;
  }
  const parsed = parse(stored);
  if (!parsed) return false;
  // The parameters come from the stored string, not from today's defaults.
  const candidate = await derive(password, parsed.salt, parsed.params);
  // Both buffers are KEY_BYTES long, which timingSafeEqual requires.
  return timingSafeEqual(candidate, parsed.hash);
}

export function needsRehash(stored, params = DEFAULT_PARAMS) {
  const parsed = parse(stored);
  if (!parsed) return true;
  const current = parsed.params;
  return current.N !== params.N || current.r !== params.r || current.p !== params.p;
}

export async function login(password, stored, params = DEFAULT_PARAMS) {
  const ok = await verifyPassword(password, stored);
  if (!ok) return { ok: false, newHash: null };
  // The only moment we hold the plain password: upgrade the hash now if the policy changed.
  const newHash = needsRehash(stored, params) ? await hashPassword(password, params) : null;
  return { ok: true, newHash };
}
