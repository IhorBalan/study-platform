import { createHash } from 'node:crypto';

export const MAX_ROUNDS = 20_000_000;

/**
 * SHA-256 applied `rounds` times: first to the UTF-8 bytes of `input`, then to
 * the bytes of the previous digest. Returns lower-case hex.
 *
 * This definition is the contract. However you restructure the work, the
 * result for a given input and rounds must stay the same.
 */
export function iteratedHash(input, rounds) {
  let digest = createHash('sha256').update(input, 'utf8').digest();
  for (let i = 1; i < rounds; i++) {
    digest = createHash('sha256').update(digest).digest();
  }
  return digest.toString('hex');
}
