// Password reset tokens: issued on request, valid for 15 minutes, usable once,
// and at most 3 per user in any 60-minute window.
//
// It works, but it is hard to test: it reads the real clock, makes random ids
// nobody can predict, and keeps its state in a module-level Map that every
// test shares. Refactor it as the task describes.
import { randomUUID } from 'node:crypto';

export const TOKEN_TTL_MS = 15 * 60 * 1000;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const MAX_TOKENS_PER_WINDOW = 3;

export class RateLimitedError extends Error {
  constructor(userId: string) {
    super(`too many reset tokens for user ${userId}`);
    this.name = 'RateLimitedError';
  }
}

const tokens = new Map<string, { userId: string; expiresAt: number }>();
const issuedAt = new Map<string, number[]>();

export function issueResetToken(userId: string): { token: string; expiresAt: number } {
  const now = Date.now();
  const recent = (issuedAt.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= MAX_TOKENS_PER_WINDOW) throw new RateLimitedError(userId);
  issuedAt.set(userId, [...recent, now]);

  const token = randomUUID();
  const expiresAt = now + TOKEN_TTL_MS;
  tokens.set(token, { userId, expiresAt });
  return { token, expiresAt };
}

/** Returns the user id for a valid token and uses the token up. Returns null otherwise. */
export function redeemResetToken(token: string): string | null {
  const entry = tokens.get(token);
  if (!entry) return null;
  tokens.delete(token);
  if (Date.now() >= entry.expiresAt) return null;
  return entry.userId;
}
