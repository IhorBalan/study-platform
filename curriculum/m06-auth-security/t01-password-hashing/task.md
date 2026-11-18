The previous developer stored passwords as one unsalted SHA-256. Replace that with scrypt from `node:crypto`, in a format that lets you raise the cost later without forcing anyone to reset their password.

## Requirements

Edit `password.mjs`. Keep its four exports and `DEFAULT_PARAMS` (`{ N: 2 ** 17, r: 8, p: 1 }`). Use Node built-ins only.

**`hashPassword(password, params = DEFAULT_PARAMS)`** resolves to a string in exactly this format:

```
$scrypt$n=131072,r=8,p=1$<salt>$<key>
```

- `<salt>` is 16 fresh random bytes per call, and `<key>` is the 32-byte output of `scrypt(password, salt, 32, { N, r, p })`. Both are base64url without padding.
- The numbers are the `params` that were used.
- A non-string password rejects with a `TypeError`. An empty one, or one longer than 1024 characters, rejects with a `RangeError`.
- It must not block the event loop. Use the asynchronous `scrypt`, not `scryptSync`.

**`verifyPassword(password, stored)`** resolves to `true` or `false` and never rejects. It reads `N`, `r`, `p` and the salt from `stored`, derives the key again and compares with `crypto.timingSafeEqual`. A stored value that does not parse is `false`.

**`needsRehash(stored, params = DEFAULT_PARAMS)`** returns `true` when `stored` names other parameters than `params`, or cannot be parsed.

**`login(password, stored, params = DEFAULT_PARAMS)`** resolves to:

| Situation | Result |
| --- | --- |
| Wrong password | `{ ok: false, newHash: null }` |
| Right password, current parameters | `{ ok: true, newHash: null }` |
| Right password, old parameters | `{ ok: true, newHash: "<fresh hash with params>" }` |

The caller stores `newHash` when it is not null.

## Tests

Write tests for your module in `test/*.test.mjs` with `node:test`, importing `../password.mjs`. `npm test` runs them. They must pass, and they must fail against a copy of your module whose `verifyPassword` also accepts wrong passwords.

## Submission

`password.mjs`, `test/` and `README.md`. In the README, answer the two questions in it: how long one default hash takes on your machine and how much memory it needs, and which algorithm and parameters you would choose for a new production service.

## What is checked

The checks hash with small parameters to stay fast, recompute the key with their own `scrypt` call, compare salts across hashes, verify right, wrong and malformed inputs, count calls to `timingSafeEqual`, walk through a parameter upgrade, run a timer during one default-cost hash to see that the event loop keeps turning, and run your tests against your module and against the broken copy.
