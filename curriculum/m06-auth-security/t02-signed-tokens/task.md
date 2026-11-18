Build the HS256 part of a JWT library by hand, to see exactly what a signed token proves and where verification goes wrong. This is an exercise: in a real project you use a maintained library such as `jose`.

## Requirements

Edit `token.mjs`. Node built-ins only. Keep the `TokenError` class: every rejection is a `TokenError` whose `code` is one of `malformed`, `unsupported-alg`, `bad-signature`, `expired`, `wrong-audience`.

**`issueToken(claims, { secret, expiresInSeconds, audience?, now? })`** returns `<header>.<payload>.<signature>`:

- header: `{ "alg": "HS256", "typ": "JWT" }`; payload: the claims plus `iat` (= `now`) and `exp` (= `now + expiresInSeconds`), and `aud` when `audience` is given;
- each part base64url without padding; the signature is `HMAC-SHA256(secret, "<header>.<payload>")`;
- `now` is seconds since the epoch and defaults to the current time.

**`verifyToken(token, { secret, audience?, now? })`** returns the payload or throws:

| Situation | Code |
| --- | --- |
| Not a string, not three base64url segments, header or payload not a JSON object, or no integer `exp` | `malformed` |
| Header `alg` is anything but exactly `HS256` (including `none`, `HS512`, `RS256` or missing) | `unsupported-alg` |
| Signature does not match. Compare with `crypto.timingSafeEqual` | `bad-signature` |
| `now >= exp` | `expired` |
| `audience` was given and `aud` is not equal to it | `wrong-audience` |

Check the algorithm and the signature before you trust any claim.

Both functions throw a `RangeError` when the secret (a string or a `Buffer`) is shorter than 32 bytes.

## Tests

Write tests in `test/*.test.mjs` with `node:test`, importing `../token.mjs`. `npm test` runs them. They must pass, and they must fail against a copy of your module whose `verifyToken` skips the signature check.

## Submission

`token.mjs`, `test/` and `README.md` with answers to its two questions.

## What is checked

The checks decode your tokens and recompute the signature, verify tokens made by their own HS256 signer, then send tampered payloads, wrong secrets, `alg: "none"` and other algorithms, expired and audience-less tokens and plain garbage, count calls to `timingSafeEqual`, and run your tests against your module and against the broken copy.
