---
title: JWTs and token-based auth
skills: [token-auth]
---

A session id is a pointer: meaningless on its own, looked up on the server. A **JSON Web Token** is the opposite: it carries the facts ("this is user 42, valid until 10:15") and a signature that proves the server issued them. Any service with the key can check it without a database call. That one property explains both why JWTs are popular and why they are easy to get wrong.

## What a JWT is

Three base64url parts joined by dots: `header.payload.signature`.

```json
{ "alg": "ES256", "typ": "JWT", "kid": "2026-11" }
```

```json
{ "iss": "https://auth.example.com", "sub": "user_42", "aud": "api.example.com",
  "iat": 1795000000, "exp": 1795000900, "jti": "f1c2..." }
```

The signature covers the first two parts. The registered claims you will meet:

| Claim | Meaning |
| --- | --- |
| `iss` | Issuer: who made the token |
| `sub` | Subject: who it is about, usually the user id |
| `aud` | Audience: which service it is for |
| `exp`, `nbf`, `iat` | Expires, not before, issued at; seconds since the epoch |
| `jti` | A unique id, useful for revocation lists |

Two facts to hold on to. First, the payload is **encoded, not encrypted**. Anyone holding the token can read it, so never put secrets or personal data in it. Second, a valid signature proves only that the issuer signed this payload. It does not prove the token is still wanted: a token stays valid until `exp`, even after logout.

## Signing algorithms

- **HS256** (HMAC with SHA-256): one shared secret both signs and verifies. Fine when one service issues and checks its own tokens. Every verifier can also forge tokens.
- **ES256, EdDSA, RS256** (asymmetric): the private key signs, the public key verifies. Other services and third parties can verify without being able to issue. Issuers publish public keys as a **JWKS** (JSON Web Key Set) at a URL, and the `kid` header says which key signed.

In the task for this lesson you build HS256 by hand with `createHmac`. That is the right way to learn it and the wrong way to ship it.

## Validation pitfalls

Most JWT breaches come from verification that checks less than it should.

- **`alg: "none"`**. The spec allows unsigned tokens. Early libraries accepted a token whose header said `none` and had no signature.
- **Algorithm confusion.** A server expects RS256 and verifies with its public key. The attacker sends `alg: "HS256"` and signs with HMAC, using that public key (which is public) as the secret. A library that lets the header pick the algorithm accepts it. Fix: the server decides the algorithm, never the token.
- **No `exp` check, or no `exp` at all.** A token that never expires is a permanent password.
- **No `aud` or `iss` check.** Your billing service accepts a token that the identity provider issued for a different app, or a token from a test environment.
- **`decode` instead of `verify`.** Every library has a function that reads the payload without checking the signature. It exists for debugging.
- **Trusting header-supplied keys.** Headers such as `jku`, `x5u` or an embedded `jwk` point at a key; an attacker points them at theirs. Use only keys you configured.

RFC 8725, the JWT Best Current Practices, lists these and more.

## Use a maintained library

In a real project use a library such as `jose`. It handles the parts that are easy to get subtly wrong: algorithm allow-lists, JWKS fetching with caching and key rotation, clock tolerance, `aud` arrays, critical headers, and the fixes for every edge case reported over the years. Your hand-written version has none of that history.

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(new URL('https://auth.example.com/.well-known/jwks.json'));

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: 'https://auth.example.com',
    audience: 'api.example.com',
    algorithms: ['ES256'],
  });
  return payload; // signature, exp, nbf, iss and aud already checked
}
```

## Access tokens and refresh tokens

Because a JWT cannot be "un-issued", keep it short-lived and pair it with something that can be revoked:

- **Access token**: a JWT, lifetime 5 to 15 minutes, sent as `Authorization: Bearer ...` to APIs. Stateless to verify.
- **Refresh token**: an opaque random string, lifetime days to weeks, stored **hashed on the server** like a session. It is sent only to the token endpoint, to get a new access token.

Revoking a user then means deleting their refresh tokens. Their access token keeps working until it expires, which is why it must expire soon.

### Rotation and reuse detection

Rotation: every time a refresh token is used, the server issues a new one and invalidates the old one. Reuse detection is what makes rotation a defence and not just bookkeeping:

1. Each login starts a **token family**. Every refresh token records its family and whether it was used.
2. On refresh, if the presented token is current, mark it used and issue the next one in the family.
3. If the presented token was **already used**, two parties hold copies: the user and a thief. You cannot tell which is which, so **revoke the whole family**. Both must log in again, and the thief's copy is dead.

The OAuth security best practice (RFC 9700) requires refresh tokens for public clients, such as browser and mobile apps, to be either rotated like this or bound to a key the client holds.

## How to revoke a JWT

You cannot change a token you handed out, so revocation always means keeping some state:

- **Short expiry** plus revocable refresh tokens. Usually enough: worst case, access lasts a few more minutes.
- **A denylist** of `jti` values, each kept until its token's `exp`. Valkey with a TTL fits well. Every request now does a lookup, which brings back the cost you tried to avoid.
- **A token version** per user: put `ver` in the token and compare it with `users.token_version`, which you increment on "log out everywhere". One cheap lookup, often cached.

## Sessions or JWTs?

| | Server-side session | JWT access token |
| --- | --- | --- |
| Verify | Look up the store | Check the signature, no lookup |
| Revoke | Delete the record, instant | Wait for `exp`, or keep a denylist |
| Size | ~40-byte cookie | Hundreds of bytes on every request |
| Across services | Every service needs the store | Any service with the public key |
| Typical fit | Browser app on its own site | Service-to-service, mobile apps, third-party APIs |

For a typical startup with one web app and one API, sessions are simpler and safer. Reach for JWTs when several services or other organisations must verify identity without calling home. Many teams use both: a session cookie at the edge, and short-lived JWTs between internal services.

## Where to keep tokens in the browser

- **`localStorage` / `sessionStorage`**: readable by any script on the page. One XSS bug, or one compromised npm dependency, and the token is sent elsewhere and used for its whole lifetime.
- **In memory** (a variable): gone on reload, still usable by an XSS payload while the page is open, but not stealable for later.
- **`HttpOnly`, `Secure`, `SameSite` cookie**: script cannot read it. XSS can still make requests while the user is on the page, but it cannot take the token away. You now need CSRF protection.

The current guidance for browser apps (the IETF's OAuth 2.0 for Browser-Based Applications best current practice) prefers a **backend for frontend (BFF)**: your server keeps the tokens, and the browser only holds a session cookie. In other words, for the browser, a session again.

## API keys for machine clients

Sessions and short-lived JWTs both assume someone can log in again. A customer's cron job or backend calling your API cannot, so B2B APIs give it an **API key**: a long-lived random secret, sent as `Authorization: Bearer <key>`. A key is not a JWT. It is an opaque pointer, like a session id, and you treat it the same way:

- **Generate** at least 32 random bytes (`randomBytes(32).toString('base64url')`) and add a recognisable prefix such as `sk_live_`. The prefix lets secret scanners, and your own `grep`, find a key that leaked into a repository or a log.
- **Store only a hash.** A key has enough entropy that a plain SHA-256 is right here (no slow password hash needed), and an indexed lookup by hash stays fast. Show the full key once, at creation; afterwards show only the prefix and the last few characters so that people can tell keys apart.
- **Tie each key to a tenant** and give it **scopes** (read-only, one resource), not the full power of the user who created it.
- **Make rotation painless.** Allow two active keys at once, so a customer can deploy the new one before revoking the old one. Record `last_used_at` so that unused keys can be found and removed, and let keys be revoked immediately.

For a higher bar, the OAuth client credentials grant swaps a long-lived secret for short-lived access tokens, at the cost of more work for every client.

## Common mistakes

- Letting the token's header choose the algorithm.
- Not checking `exp`, `aud` and `iss` on every verification.
- Putting email addresses, roles that change often, or secrets in the payload.
- Access tokens that live for days, "because refresh is complicated".
- Refresh tokens stored in plain text, or never rotated.
- Tokens in `localStorage` for a browser app that handles anything valuable.
- Storing API keys in plain text, or giving every key full access to the account.
- Calling a JWT "stateless logout": logging out of a JWT-only system does nothing until `exp`.

## Go deeper

- [RFC 7519: JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519): the format and the registered claims.
- [RFC 8725: JWT Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725): the validation pitfalls, from the authors of the standard.
- [RFC 9700: OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700): refresh token rotation and sender-constrained tokens.
- [OAuth 2.0 for Browser-Based Applications](https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/): BFF and where tokens may live in a browser.
- [jose](https://github.com/panva/jose): the library used above, with its API reference.
