import { createHash } from 'node:crypto';

/**
 * The cost parameters new hashes should use. OWASP's minimum for scrypt is
 * N = 2^17 (128 MiB with r = 8), r = 8, p = 1.
 */
export const DEFAULT_PARAMS = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });

// This is what the previous developer shipped. It works, and it is exactly what
// the lesson tells you not to do: one fast SHA-256, no salt, and a plain string
// comparison. Replace all of it.

/**
 * Hashes a password for storage.
 *
 * TODO: use scrypt from node:crypto (the async version) with a fresh 16-byte
 * random salt per password and a 32-byte key, and return
 * `$scrypt$n=<N>,r=<r>,p=<p>$<salt>$<hash>` with salt and hash in base64url.
 * TODO: reject a non-string with a TypeError, and an empty string or one
 * longer than 1024 characters with a RangeError.
 *
 * @param {string} password
 * @param {{ N: number, r: number, p: number }} [params]
 * @returns {Promise<string>}
 */
export async function hashPassword(password, params = DEFAULT_PARAMS) {
  return createHash('sha256').update(password).digest('hex');
}

/**
 * Checks a password against a stored hash. Never throws: anything that does
 * not match, including a malformed stored value, is `false`.
 *
 * TODO: read N, r, p and the salt from `stored`, derive the key again and
 * compare it with crypto.timingSafeEqual.
 *
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  return (await hashPassword(password)) === stored;
}

/**
 * TODO: true when `stored` was made with parameters other than `params`, or
 * cannot be parsed.
 *
 * @param {string} stored
 * @param {{ N: number, r: number, p: number }} [params]
 * @returns {boolean}
 */
export function needsRehash(stored, params = DEFAULT_PARAMS) {
  return false;
}

/**
 * Verifies a login attempt and upgrades the stored hash when the policy changed.
 *
 * TODO: `{ ok: false, newHash: null }` for a wrong password; `{ ok: true,
 * newHash: null }` when the stored hash is current; `{ ok: true, newHash }` with
 * a fresh hash made with `params` when it is not.
 *
 * @param {string} password
 * @param {string} stored
 * @param {{ N: number, r: number, p: number }} [params]
 * @returns {Promise<{ ok: boolean, newHash: string | null }>}
 */
export async function login(password, stored, params = DEFAULT_PARAMS) {
  return { ok: await verifyPassword(password, stored), newHash: null };
}
