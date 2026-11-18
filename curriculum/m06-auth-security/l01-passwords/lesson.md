---
title: "Passwords: storing them so a breach is not a disaster"
skills: [password-storage]
---

Sooner or later someone will read your `users` table who should not: a leaked backup, an SQL injection, a laptop left on a train. Password storage is about that day. If you did it right, the attacker gets a pile of values that cost them real money to test one guess at a time. If you did it wrong, they get your users' passwords, and since people reuse passwords, also their email and bank accounts.

## Why not SHA-256

A hash function looks like the right tool: one-way, fixed output, standard library. The problem is that SHA-256 was designed to be **fast**. A single modern GPU computes billions of SHA-256 hashes per second. An attacker with your table runs a list of a few billion leaked passwords and their variations against it in minutes.

Without a **salt** it is worse. Two users with the password `summer2024` get the same hash, so cracking one cracks both, and precomputed tables (hash to password) work against every unsalted SHA-256 database in the world at once.

So a password hash needs three properties that a general-purpose hash lacks:

1. **A unique random salt per password**, stored next to the hash. Same password, different hash. Precomputed tables become useless.
2. **A tunable cost**, so each guess takes real time. You pay that cost once per login; the attacker pays it for every guess.
3. **Memory hardness**, so each guess also needs a lot of RAM. GPUs and custom chips have huge compute but little memory per core, which kills their advantage.

Encryption is not the answer either. Anything you can decrypt, an attacker who gets the key can decrypt. You never need the password back; you only need to check a guess.

## The algorithms

| Algorithm | Memory-hard | Notes |
| --- | --- | --- |
| **argon2id** | Yes | Won the Password Hashing Competition, first choice in RFC 9106 and in OWASP's cheat sheet. Memory, time and parallelism are tuned separately. |
| **scrypt** | Yes | Older, still sound. In `node:crypto` since forever. |
| **bcrypt** | No (small fixed memory) | Fine for existing systems. Uses only the first 72 bytes of the password. |
| PBKDF2 | No | Use only where FIPS-140 compliance demands it, with a very high iteration count. |

OWASP's current minimums (check the cheat sheet in "Go deeper" before you pick numbers; they move as hardware gets faster):

- **argon2id**: 19 MiB of memory, 2 iterations, parallelism 1.
- **scrypt**: N = 2^17 (128 MiB with r = 8), r = 8, p = 1.
- **bcrypt**: cost 10 or more, and enforce a 72-byte maximum.
- **PBKDF2-HMAC-SHA256**: 600,000 iterations.

Then tune on your own servers: aim for a hash that takes a few hundred milliseconds, and raise the cost over the years.

**In Node.** Node 24.7 added `crypto.argon2()` to the standard library. On older versions, use a maintained package such as `argon2`. The exercises in this module use scrypt, which every Node version has, and the ideas carry over unchanged.

```ts
import { argon2, randomBytes } from 'node:crypto';

const nonce = randomBytes(16); // the salt
argon2('argon2id', { message: 'correct horse', nonce, memory: 19456, passes: 2, parallelism: 1, tagLength: 32 },
  (err, key) => { if (err) throw err; console.log(key.toString('base64url')); });
```

`memory` is in KiB here: 19456 KiB is 19 MiB.

## Store the parameters with the hash

A stored hash must say how it was made, or you can never change the cost. The usual shape is a self-describing string, similar to the PHC string format:

```
$scrypt$n=131072,r=8,p=1$<salt base64>$<key base64>
```

Verification reads the algorithm, parameters and salt **from the stored string**, recomputes the key from the submitted password and compares. New hashes use today's parameters. Old hashes still verify with theirs.

That gives you **rehash on login**. The only moment you hold the plain password is during a successful login. If the stored string names older parameters (or an older algorithm, say SHA-1 from a legacy system), hash the password again with the current settings and update the row. Over a few months, active users migrate without noticing.

## A scrypt version in Node

```ts
import { randomBytes, scrypt, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// promisify picks scrypt's overload without options, so state the type we use.
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, o: ScryptOptions) => Promise<Buffer>;
const P = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export async function hash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, P);
  return `$scrypt$n=${P.N},r=${P.r},p=${P.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
```

Two Node details. First, `maxmem`: scrypt needs 128 × N × r bytes, and Node refuses anything over 32 MiB unless you raise the limit. Second, use the **asynchronous** version. It runs in libuv's thread pool, so the event loop keeps serving other requests. `scryptSync` would freeze your whole server for every login. The pool has four threads by default (`UV_THREADPOOL_SIZE`), which also caps how many hashes run at once. That is one more reason to rate-limit the login route.

## Comparing without leaking

`a === b` on strings, and `Buffer.equals`, stop at the first byte that differs. In theory the response time tells an attacker how many leading bytes were right. Over a network that signal is tiny, but it is real enough that the fix is standard: compare secrets with `crypto.timingSafeEqual`, which always looks at every byte. It throws when lengths differ, so check the length first and treat a mismatch as a failure.

Timing leaks also hide one level up. If an unknown email returns at once and a known email takes 250 ms to hash, the response time tells the attacker which emails have accounts. Hash a dummy value for unknown users, and return the same message for "no such user" and "wrong password".

## Credential stuffing and rate limits

Most account takeovers today do not crack your hashes. They take email and password pairs leaked from other sites and try them on yours. This is **credential stuffing**, and good hashing does nothing against it, because the attacker has the right password.

Defences, roughly in order of value:

- **Multi-factor authentication** or passkeys (lesson 7). A stolen password alone is no longer enough.
- **Rate limits** per account and per IP address, with growing delays after failures. Lock-outs need care: a hard lock lets anyone lock out any user.
- **Breached-password checks** at sign-up and password change. The Have I Been Pwned range API lets you check a password using only the first five characters of its SHA-1, so the password never leaves your server.
- **Bot signals**: many accounts, one IP; one account, many countries.

## Password rules that help

NIST SP 800-63B, the reference most auditors use, now says: require a minimum length (15 characters when the password is the only factor, 8 when it is combined with another), allow at least 64, accept every character including spaces and emoji, check against breached and common passwords, and **do not** force composition rules ("one uppercase, one symbol") or periodic changes. Those rules produce `Summer2024!` and then `Autumn2024!`. Normalise Unicode (for example to NFC) before hashing, so the same password typed on two keyboards matches.

## Common mistakes

- Using SHA-256, SHA-512 or MD5 for passwords, with or without a salt.
- One salt for the whole table, or a salt derived from the username.
- Storing the hash without its parameters, so the cost can never go up.
- `scryptSync` or `argon2Sync` in a request handler.
- Comparing hashes with `===`, and returning different errors for unknown users and wrong passwords.
- Treating good hashing as protection against credential stuffing.
- Silently truncating long passwords (bcrypt at 72 bytes) instead of rejecting or pre-hashing them deliberately.

## Go deeper

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): current parameters for each algorithm, peppering and migration.
- [RFC 9106: Argon2](https://www.rfc-editor.org/rfc/rfc9106): the specification, with recommended settings.
- [Node.js crypto](https://nodejs.org/api/crypto.html): `scrypt`, `argon2`, `timingSafeEqual` and `randomBytes`.
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html): password length, breached-password checks and why composition rules are gone.
- [OWASP Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html): layered defences against stolen password lists.
