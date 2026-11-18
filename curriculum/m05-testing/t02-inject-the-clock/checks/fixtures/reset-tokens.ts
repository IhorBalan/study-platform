// Password reset tokens: issued on request, valid for 15 minutes, usable once,
// and at most 3 per user in any 60-minute window.
//
// Time and randomness come in through `deps`, and the state lives inside each
// instance, so a test can control the clock and start from a clean slate.
import { randomUUID } from 'node:crypto';

export const TOKEN_TTL_MS = 15 * 60 * 1000;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const MAX_TOKENS_PER_WINDOW = 3;

export interface Clock {
  /** Milliseconds since the Unix epoch, like Date.now(). */
  now(): number;
}

export interface ResetTokenDeps {
  clock: Clock;
  randomId: () => string;
}

export interface ResetTokens {
  issue(userId: string): { token: string; expiresAt: number };
  /** Returns the user id for a valid token and uses the token up. Returns null otherwise. */
  redeem(token: string): string | null;
}

export const systemClock: Clock = { now: () => Date.now() };

export class RateLimitedError extends Error {
  constructor(userId: string) {
    super(`too many reset tokens for user ${userId}`);
    this.name = 'RateLimitedError';
  }
}

export function createResetTokens(deps: Partial<ResetTokenDeps> = {}): ResetTokens {
  const clock = deps.clock ?? systemClock;
  const randomId = deps.randomId ?? (() => randomUUID());
  const tokens = new Map<string, { userId: string; expiresAt: number }>();
  const issuedAt = new Map<string, number[]>();

  return {
    issue(userId) {
      const now = clock.now();
      const recent = (issuedAt.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
      if (recent.length >= MAX_TOKENS_PER_WINDOW) throw new RateLimitedError(userId);
      issuedAt.set(userId, [...recent, now]);

      const token = randomId();
      const expiresAt = now + TOKEN_TTL_MS;
      tokens.set(token, { userId, expiresAt });
      return { token, expiresAt };
    },

    redeem(token) {
      const entry = tokens.get(token);
      if (!entry) return null;
      tokens.delete(token);
      if (clock.now() >= entry.expiresAt) return null;
      return entry.userId;
    },
  };
}
