---
title: Sessions and cookies
skills: [session-auth]
---

HTTP forgets you between requests. After a successful login the server needs a way to recognise the next request as yours. The oldest answer is still the default for a web app on its own domain: a random **session id** in a cookie, pointing at a record on the server. This lesson is about getting the details right, because each cookie flag and each step at login or logout closes a specific attack.

## How a server-side session works

1. The user logs in. The server creates a random, unguessable id and stores a record: user id, created, last seen, expires, maybe the device name.
2. The response sets a cookie holding the id.
3. The browser sends the cookie with every later request to that site. The server looks up the record and knows who is calling.
4. Logout deletes the record. The cookie now points at nothing.

From the React side this feels like magic: `fetch('/api/me', { credentials: 'include' })` just works, and your code never touches the id. That is exactly the point. Script that cannot see the id cannot leak it.

The id must come from a cryptographically secure generator and be long enough that guessing is hopeless: 128 bits or more. `crypto.randomBytes(32).toString('base64url')` gives 256 bits. Never use `Math.random()`, a counter, or a hash of the user id and a timestamp.

Store the session in Postgres or Valkey. Valkey suits it well: a key per session with a TTL, and expiry happens for free. Postgres works fine at most scales and makes "list my devices" an ordinary query. Either way it is one indexed lookup per request.

**Store a hash of the id, not the id.** If the sessions table leaks, raw ids are live credentials for everyone logged in. A SHA-256 of the id is enough here. Unlike a password, the id is random and long, so there is nothing to brute-force and a slow hash would only cost you latency.

```ts
import { createHash, randomBytes } from 'node:crypto';

export function newSessionToken() {
  const token = randomBytes(32).toString('base64url');            // goes in the cookie
  const tokenHash = createHash('sha256').update(token).digest('hex'); // goes in the database
  return { token, tokenHash };
}
```

## Cookie attributes, one attack each

```http
Set-Cookie: __Host-sid=Jx3f...; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800
```

| Attribute | What it does | What it prevents |
| --- | --- | --- |
| `HttpOnly` | `document.cookie` cannot read it | An XSS bug stealing the session id |
| `Secure` | Sent only over HTTPS | The id leaking on plain HTTP, for example on public Wi-Fi |
| `SameSite=Lax` | Not sent on cross-site subrequests and cross-site `POST`s; sent on top-level navigation by link | Most cross-site request forgery |
| `SameSite=Strict` | Never sent on any cross-site request, even following a link | More CSRF, at the cost of looking logged-out when arriving from another site |
| `Max-Age` / `Expires` | When the browser drops it | Ids living forever in a shared browser |
| `Path=/`, no `Domain` | Sent only to this exact host | Sibling subdomains receiving or overwriting it |
| `__Host-` prefix | Browser enforces `Secure`, `Path=/` and no `Domain` | A subdomain or a plain-HTTP page planting a cookie with the same name |

Without `Domain` a cookie is "host-only", which is what you want unless you really share a login across subdomains. `SameSite=None` exists for cookies that must work in third-party contexts (an embedded widget), requires `Secure`, and puts all the CSRF work back on you.

Chromium-based browsers treat a cookie without `SameSite` as `Lax`, but not every browser applies that default. Always set it explicitly.

## SameSite is not the whole CSRF story

`SameSite` works on **sites**, not origins. `evil.example.com` and `app.example.com` are the same site, so a compromised or user-controlled subdomain can still send your cookies. `Lax` also allows top-level `GET` navigation, so any `GET` that changes state is still exposed. Two habits close the gaps:

- **Never change state on `GET`.**
- **Check where state-changing requests come from.** Reject `POST`, `PUT`, `PATCH` and `DELETE` whose `Origin` header (or the `Sec-Fetch-Site` header, which modern browsers send) does not match your app, or add a CSRF token. Lesson 5 covers both.

## Session fixation

The attack: the attacker gets a valid session id from your site (anonymous sessions often exist for carts or CSRF tokens), plants it in the victim's browser, waits for the victim to log in, then uses the same id, which is now logged in.

The fix is one line of discipline: **issue a new session id at login**, and again whenever privileges change (switching organisation, becoming admin, completing MFA). Delete the old record. Never accept a session id from a URL parameter.

## Expiry and logout

Two timeouts work together:

- **Idle timeout**: the session dies after, say, 30 minutes to a few hours without a request. Each request moves `expires_at` forward ("sliding" expiry). To avoid a database write per request, only extend when the remaining time drops below a threshold.
- **Absolute timeout**: the session dies after, say, 7 or 30 days whatever happens. This limits how long a stolen id is useful.

Pick the numbers by risk: a banking app uses minutes, a note-taking app weeks.

**Logout** deletes the server record and clears the cookie. With the cookie support built into NestJS (since 12.1), that looks like this:

```ts
import { Controller, Cookies, HttpCode, Post, Res } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

const COOKIE = { path: '/', secure: true, httpOnly: true, sameSite: 'lax' } as const;

@Controller('auth')
export class LogoutController {
  constructor(private readonly sessions: SessionsService, private readonly adapterHost: HttpAdapterHost) {}

  @Post('logout')
  @HttpCode(204)
  async logout(@Cookies('__Host-sid') token: string | undefined, @Res({ passthrough: true }) res: unknown) {
    if (token) await this.sessions.revoke(token);
    this.adapterHost.httpAdapter.clearCookie(res, '__Host-sid', COOKIE);
  }
}
```

Clearing must use the same name, path and domain as the original cookie, or the browser keeps the old one. The deletion on the server is what matters: a cookie that someone copied earlier stops working at that moment.

**Log out everywhere** is a `DELETE FROM sessions WHERE user_id = $1`. Do it automatically on a password change or reset, and when an admin disables an account. That immediacy is the main reason server-side sessions stay popular: revocation is instant and simple.

## Reading and setting the cookie in NestJS

`@Cookies('__Host-sid')` from `@nestjs/common` reads one cookie, and `httpAdapter.setCookie(res, name, value, options)` sets one, the same way on Express and Fastify. Note that `maxAge` is in **seconds** there, unlike Express's own `res.cookie()`, which takes milliseconds. Older apps use the `cookie-parser` middleware instead; both keep working.

At login, after the password checks out, create a new session and set the cookie:

```ts
const { token } = await this.sessions.create(user.id);   // stores only the hash
this.adapterHost.httpAdapter.setCookie(res, '__Host-sid', token, { ...COOKIE, maxAge: 8 * 60 * 60 });
```

On every other request a global guard reads the cookie, hashes it, loads the session and the user, and sets `request.user`, just like the bearer-token guard you will write in this module.

## When sessions fit, and when they get awkward

Sessions fit a browser app talking to its own backend on the same site. They need a shared store as soon as you run more than one instance, which most backends already have.

They get awkward when the caller is not a browser on your site: a mobile app (no automatic cookie jar across launches unless you build one), third-party API clients, or many independent services that all need to know who the user is. Lesson 3 covers tokens for those cases, and why many teams still use a session at the edge and tokens only behind it.

## Common mistakes

- A session id from a weak generator, or one that encodes the user id.
- Storing raw session ids, so a database leak logs the attacker in as everyone.
- Missing `HttpOnly`, `Secure` or an explicit `SameSite`.
- Keeping the same id across login, which enables session fixation.
- Logout that only clears the cookie and leaves the server record alive.
- No absolute timeout, so a stolen id works for months.
- State-changing `GET` routes, relying on `SameSite=Lax` alone.

## Go deeper

- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): id generation, timeouts, fixation and logout.
- [MDN: Using HTTP cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies): every attribute, prefixes and how browsers apply them.
- [RFC 6265: HTTP State Management Mechanism](https://www.rfc-editor.org/rfc/rfc6265): the cookie specification itself.
- [NestJS: Cookies](https://docs.nestjs.com/techniques/cookies): reading and setting cookies with the Express adapter.
