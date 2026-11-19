---
title: The web vulnerabilities a backend must prevent
skills: [web-vulnerabilities]
---

Most serious web vulnerabilities come down to one mistake: data from outside is treated as instructions, or as permission. This lesson takes the five a Node backend meets most often (injection, XSS, CSRF, SSRF and mass assignment), shows the bug and its fix, and maps each to the OWASP Top 10:2025, the list auditors and interviewers will use.

## The OWASP Top 10:2025 in one table

| ID | Category | In this lesson |
| --- | --- | --- |
| A01 | Broken Access Control | CSRF, SSRF (now part of A01) and the BOLA of lesson 4 |
| A02 | Security Misconfiguration | |
| A03 | Software Supply Chain Failures | Dependencies and install scripts |
| A04 | Cryptographic Failures | |
| A05 | Injection | SQL and command injection, and XSS |
| A06 | Insecure Design | |
| A07 | Authentication Failures | Lessons 1 to 3 |
| A08 | Software or Data Integrity Failures | Mass assignment (CWE-915) |
| A09 | Security Logging and Alerting Failures | |
| A10 | Mishandling of Exceptional Conditions | |

Two changes since 2021 are worth knowing: SSRF lost its own entry and moved into Broken Access Control, and the old "vulnerable components" risk grew into Software Supply Chain Failures at A03, covering every link from dependencies to build pipelines. For APIs, the OWASP API Security Top 10 (2023) is the companion list; mass assignment sits there under API3, Broken Object Property Level Authorization.

## Injection (A05)

Injection happens when input becomes part of a command that another interpreter parses: SQL, a shell, a template, a query language.

```ts
// Vulnerable: the input is part of the SQL text.
db.query(`SELECT * FROM invoices WHERE customer ILIKE '%${search}%'`);
// search = "' OR '1'='1"  ->  every row
// search = "x' UNION SELECT email, password_hash FROM users --"  ->  your users
```

**Fix: parameters.** The SQL text is fixed, and values travel separately, so the database never parses them as SQL:

```ts
db.query(`SELECT id, customer FROM invoices WHERE owner_id = $1 AND customer ILIKE '%' || $2 || '%'`, [userId, search]);
```

Parameters carry **values** only. Column names, table names and `ASC`/`DESC` are structure, so they cannot be parameters. When the client chooses a sort column, map the allowed keys to SQL fragments you wrote and reject anything else:

```ts
const SORTS = { amount: 'amount_cents ASC', '-amount': 'amount_cents DESC' } as const;
if (!Object.hasOwn(SORTS, sort)) throw new BadRequestException('unknown sort');
```

Query builders and ORMs such as Drizzle parameterise for you, until you reach for their raw escape hatch (`sql.raw()` and friends) with input in it. Other interpreters have the same disease:

- **Shell**: `exec(\`convert ${file} out.png\`)` runs whatever `file` says. Use `execFile('convert', [file, 'out.png'])`, which passes arguments without a shell.
- **NoSQL**: `{ email: req.body.email }` with a body of `{ "email": { "$ne": null } }` matches everyone. Validate that the value is a string.
- **Templates**: never build a template from input; pass input as data.

## Cross-site scripting (A05)

XSS is injection into HTML: input ends up in a page as script. React escapes text by default, which is why you may never have met it. It comes back through:

- `dangerouslySetInnerHTML` with user content (rich-text comments, markdown rendered to HTML);
- `href={userUrl}` with a `javascript:` URL;
- HTML the server renders or emails it sends;
- user uploads (HTML, SVG) served from your own domain.

What the backend does:

- **Return JSON as JSON.** `Content-Type: application/json` plus `X-Content-Type-Options: nosniff`, so a browser never renders an API response as HTML.
- **Sanitise HTML you must accept** with a maintained sanitiser (DOMPurify is the usual choice), with an allow-list of tags. Do not write your own.
- **Serve uploads from another domain**, or with `Content-Disposition: attachment`.
- **Send a Content Security Policy.** A strict CSP (`script-src 'self'`, or nonces) stops injected inline scripts from running. It is your second line of defence when escaping fails somewhere.
- **Keep sessions in `HttpOnly` cookies**, so a successful XSS cannot carry the session away.

## Cross-site request forgery (A01)

CSRF makes a victim's browser send a request to your site from someone else's page. If you authenticate with cookies, the browser attaches them, and your server sees a valid, logged-in request it never meant to receive:

```html
<!-- on evil.example -->
<form action="https://app.example.com/api/transfer" method="POST">
  <input name="to" value="attacker"><input name="amount" value="5000">
</form>
<script>document.forms[0].submit()</script>
```

Defences, layered:

1. **`SameSite=Lax` or `Strict` cookies** (lesson 2). Blocks the example above in current browsers.
2. **No state changes on `GET`.**
3. **Check the origin of unsafe requests.** Reject `POST`, `PUT`, `PATCH` and `DELETE` when `Sec-Fetch-Site` is `cross-site`, or when `Origin` is present and not your app's origin.
4. **CSRF tokens** where you need more: a random token bound to the session, sent in a header or form field, compared on the server.

APIs that authenticate with an `Authorization: Bearer` header are not exposed to CSRF, because the browser never adds that header on its own. That is a property of the transport, not a reason to store tokens in `localStorage`.

## Server-side request forgery (A01)

SSRF happens when your server fetches a URL the client chose: a webhook target, an avatar URL, a link preview. The attacker chooses a URL only your server can reach:

- `http://169.254.169.254/...`, the cloud metadata service, which can hand out the server's cloud credentials;
- `http://localhost:9200/`, an internal admin port or database;
- `http://10.0.0.5/`, other services in your private network.

Fixes, from strongest:

- **Do not fetch arbitrary URLs.** Use an allow-list of hosts when the feature allows it.
- **Validate the address you connect to, not the string.** Parse the URL and allow only `https`. Resolving the hostname, checking the IP and then calling `fetch(url)` is not enough: `fetch` resolves the name again, and the second answer can be `169.254.169.254` (DNS rebinding). Do the check inside the connection instead: use the `undici` package's `fetch` with an `Agent` whose `connect.lookup` rejects private, loopback, link-local and metadata addresses, so the address you check is the address you connect to. The lookup is skipped for a URL that already holds an IP, so check IP literals yourself. Check again after every redirect, or disable redirects (`fetch(url, { redirect: 'manual' })`).
- **Isolate egress**: send such requests through a proxy or network that cannot reach internal ranges, and require session tokens for the cloud metadata service (IMDSv2 on AWS).

## Mass assignment (A08, API3)

Mass assignment happens when the server copies a request body into a model without choosing the fields:

```ts
// Vulnerable: every key in the body becomes a column.
await db.users.update(user.id, req.body);   // { "role": "admin" }
```

It looks harmless in review because the happy path only sends `{ "name": "Ada" }`. The fix is an explicit allow-list at the boundary and explicit columns in the query:

```ts
const UpdateMe = z.strictObject({ name: z.string().min(1).max(100) });   // unknown keys -> 400
await db.query('UPDATE users SET name = $1 WHERE id = $2', [input.name, user.id]);
```

The mirror image is **excessive data exposure**: `SELECT *` or `RETURNING *` sent straight to the client leaks `password_hash`, internal flags and other users' emails. Name the columns, or map rows to a response type.

## Supply chain: the code you did not write (A03)

A Node service runs hundreds of packages written by strangers, and `npm install` gives each of them two chances to act: when it is installed (lifecycle scripts such as `postinstall` run with your user's rights) and when it is imported. In September 2025 the Shai-Hulud worm used exactly this. A hijacked package's install script stole npm and GitHub tokens from the machine, then used them to publish infected versions of the victim's own packages. Nobody typed a wrong package name; an ordinary install of an ordinary dependency was enough.

The defence is a short list of habits, none of them clever:

- **Commit the lockfile and install from it.** `npm ci` or `pnpm install --frozen-lockfile` installs exactly the recorded versions and fails if `package.json` disagrees. A plain `npm install` in CI can pull a version nobody reviewed.
- **Do not run install scripts by default.** pnpm 10 and later skip dependency scripts unless the package is on an allow-list in `pnpm-workspace.yaml`; with npm, set `ignore-scripts=true` in `.npmrc`. Allow the few packages that need a build step (`esbuild`, native modules) by name.
- **Wait before installing a new release.** Most hijacked versions are found and removed within hours. pnpm's `minimumReleaseAge` (in minutes) refuses anything younger; this repository sets it to one day.
- **Update through reviewed pull requests.** Dependabot or Renovate opens one for each update, so a version change is a diff someone reads and CI tests, and not a side effect of another change.
- **Audit, and know the limit.** `npm audit` and `pnpm audit` compare the lockfile with known advisories. They find old vulnerabilities; they cannot see a malicious version published an hour ago.
- **Prefer packages with provenance.** A package published with npm provenance, through trusted publishing from CI, carries a signed statement of the repository and workflow that built it, and no long-lived publish token exists to steal.
- **Keep secrets away from installs.** A CI job that only installs and tests needs no deploy keys. Pin GitHub Actions by commit SHA for the same reason: a tag can be moved to new code (module 14, lesson 2).

This repository's `supply-chain` CI job is a working example: it installs with `--frozen-lockfile --ignore-scripts` and fails on any high or critical advisory.

## The common thread

| Bug | Input treated as | Fix |
| --- | --- | --- |
| SQL injection | SQL code | Bind parameters; allow-list identifiers |
| XSS | HTML and script | Escape on output, sanitise accepted HTML, CSP |
| CSRF | The user's intent | SameSite cookies, origin checks, tokens |
| SSRF | A trusted destination | Allow-lists, address checks, isolated egress |
| Mass assignment | Permission to set fields | Strict schemas and explicit columns |

## Common mistakes

- Escaping quotes by hand instead of using parameters.
- Interpolating a sort column or table name because "it is only from our own UI".
- Assuming React's escaping protects HTML the server renders.
- `SameSite` cookies with state-changing `GET` routes.
- Blocking `localhost` by string comparison and missing `127.1`, IPv6 or DNS tricks.
- Passing `req.body` to an ORM's `update` or `create`.
- Error responses that include stack traces or SQL errors.

## Go deeper

- [OWASP Top 10:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/): the categories and what changed since 2021.
- [OWASP Query Parameterization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html): parameters in many languages and their limits.
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): tokens, Fetch Metadata and SameSite.
- [OWASP Server-Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): allow-lists, address validation and redirects.
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP): directives, nonces and reporting.
