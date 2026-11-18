`src/reset-tokens.ts` issues password reset tokens. It works, and it is hard to test: it reads `Date.now()`, calls `randomUUID()`, and keeps its state in module-level `Map`s that every test shares. Testing expiry would mean waiting 15 minutes. Make time and randomness injectable, then test the module with a fake clock.

## The behaviour (unchanged)

- `issue(userId)` returns `{ token, expiresAt }`. `expiresAt` is the issue time plus 15 minutes, in milliseconds since the epoch.
- `redeem(token)` returns the user id while the current time is before `expiresAt`, and `null` from `expiresAt` on. A token works once. An unknown token gives `null`.
- A user may be issued at most 3 tokens in any 60-minute window: a token issued at time `t` counts while `now - t < 60 minutes`. The 4th throws `RateLimitedError`. Each user has their own limit. Redeeming a token does not free a slot.

## Requirements

Export from `src/reset-tokens.ts`:

```ts
export interface Clock { now(): number }
export function createResetTokens(deps?: { clock?: Clock; randomId?: () => string }): {
  issue(userId: string): { token: string; expiresAt: number };
  redeem(token: string): string | null;
};
```

- The token is exactly the value `deps.randomId()` returned. Missing deps fall back to the real clock and `randomUUID()`.
- Each `createResetTokens()` call has its own state.
- Keep exporting `RateLimitedError`, `TOKEN_TTL_MS`, `RATE_WINDOW_MS` and `MAX_TOKENS_PER_WINDOW`. Drop `issueResetToken` and `redeemResetToken`.
- Write tests in `test/*.test.ts` with `node:test`. Pass a fake clock and a predictable `randomId` to `createResetTokens()`. Do not mock globals such as `Date`; the point is the injected seam. Each test may take at most 5 seconds, so no real waiting.
- Add two to four sentences to `README.md` on what made the code testable.

## Submission

The folder with `src/`, `test/`, `package.json` and `README.md`, without `node_modules`.

## What is checked

The checks drive your module with their own fake clock and ids: expiry at the exact boundary, single use, the rate limit per user and at the window's edge, and the defaults with the real clock. Then they run your tests against a reference implementation (they must pass) and against broken copies, such as one that reads `Date.now()` in `redeem()` or frees a rate-limit slot too early. Your tests must fail for each broken copy.
