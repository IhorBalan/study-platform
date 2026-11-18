# Reset tokens: inject the clock

Password reset tokens that expire after 15 minutes, work once, and are rate-limited to 3 per user per hour. The code is correct but cannot be tested without waiting or sharing state between tests. Read the task brief, refactor, then write the tests.

```sh
npm test            # runs test/**/*.test.ts with node:test, no install needed
npm install         # only for editor types and `npm run typecheck`
```

Node strips the TypeScript types when it runs a `.ts` file, so use only syntax that can be erased: no `enum`, no `namespace`, no constructor parameter properties such as `constructor(private clock: Clock)`. Import local files with their `.ts` extension.

## What made it testable

The module used to reach out for the time (`Date.now()`) and for randomness (`randomUUID()`), so a test could neither move time forward nor predict a token. Now both come in through `deps`, with the real ones as defaults, so production code calls `createResetTokens()` with no arguments and tests pass a `FakeClock` and a sequential id generator. The state moved inside the factory, so each test gets a fresh instance and the tests no longer depend on each other or on their order.
