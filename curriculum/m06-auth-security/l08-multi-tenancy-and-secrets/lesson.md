---
title: Multi-tenancy and secrets
skills: [tenant-isolation, secrets-management]
---

Two failures end B2B startups faster than slow pages: one customer seeing another customer's data, and a leaked key that lets a stranger into production. Both are preventable with boring discipline. This lesson covers how to keep tenants apart in a shared database, with Row-Level Security as a safety net, and how to handle secrets, including what to do in the first hour after one lands in git.

## Tenancy models

A **tenant** is the customer account that owns data: a company, a workspace, a team. Three ways to keep tenants apart:

| Model | Isolation | Cost and effort |
| --- | --- | --- |
| Shared tables with a `tenant_id` column | Enforced by your code (and RLS) | Cheapest; one schema to migrate; the default for most SaaS |
| Schema per tenant | Enforced by `search_path` | Migrations run once per tenant; thousands of schemas get painful |
| Database per tenant | Strong, separate backups and keys | Most expensive; for large or regulated customers |

Most products start with shared tables and move a few big customers to their own database later. The rest of this section assumes shared tables.

## A tenant id on every query

The rule is simple to state: **every query against tenant data filters by the tenant, and the tenant comes from the authenticated session, never from the request.**

```ts
// The tenant comes from the session that the guard loaded.
const rows = await db.query(
  'SELECT id, customer, amount_cents FROM invoices WHERE tenant_id = $1 AND id = $2',
  [user.tenantId, id],
);
```

A `tenantId` in a body, query string or header is input, not identity. If users can belong to several tenants, the client may *ask* for a tenant (a URL segment such as `/orgs/:orgId/...`), and the server checks membership before using it.

Habits that make the rule hard to break:

- **Repository methods take the tenant as a required argument**, so forgetting it is a type error: `invoices.find(tenantId, id)`.
- **Composite keys and foreign keys include the tenant**: `UNIQUE (tenant_id, number)`, and `FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)`, so an invoice cannot point at another tenant's customer.
- **Indexes start with `tenant_id`**, which matches every query you run.
- **Everything else is scoped too**: cache keys (`t:{tenantId}:invoice:{id}`), queue job payloads, object storage paths, search indexes, exports, logs, and analytics.

## Row-Level Security as a safety net

Code review catches most missing filters. PostgreSQL's **Row-Level Security** (RLS) catches the rest: the database itself adds the tenant condition to every query on the table.

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON invoices
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

`USING` filters the rows a query can see, update or delete. `WITH CHECK` refuses inserts and updates that would write another tenant's id. `current_setting(..., true)` returns null or an empty string instead of failing when the setting is missing, so a query without tenant context sees **no rows**. It fails closed.

The application sets the tenant per transaction:

```ts
await client.query('BEGIN');
await client.query("SELECT set_config('app.tenant_id', $1, true)", [user.tenantId]);
const { rows } = await client.query('SELECT id, customer FROM invoices');   // only this tenant's rows
await client.query('COMMIT');
```

The third argument of `set_config`, `true`, makes the setting local to the transaction. That matters with a connection pool: a session-level `SET` would stay on the connection and leak into the next request that borrows it.

Three things that silently switch RLS off:

- **Superusers and roles with `BYPASSRLS`** ignore policies. Your app must connect as an ordinary role.
- **The table owner** ignores its own table's policies unless you also run `ALTER TABLE invoices FORCE ROW LEVEL SECURITY`. Migrations usually run as the owner; the app should not.
- **No policy at all** with RLS enabled denies everything, which at least fails loudly.

Keep the `WHERE tenant_id = $1` in your queries anyway. It documents intent, uses the index well, and keeps the app correct if RLS is ever misconfigured. The PostgreSQL module covers RLS in more depth.

## Secrets

A secret is anything that grants access: database passwords, API keys for Stripe or email providers, signing keys for tokens and cookies, OAuth client secrets, cloud credentials.

**Where they live:**

- **Never in the repository**, including `.env.example` with real values, test fixtures and Dockerfiles. Add `.env` to `.gitignore` on day one.
- **Local development**: a `.env` file loaded with `node --env-file=.env`, using keys for test-mode or local services only.
- **Production**: a secret manager (AWS Secrets Manager or SSM Parameter Store, GCP Secret Manager, Doppler, Vault, or your platform's encrypted variables), injected at runtime as environment variables or read at start-up. The cloud module covers the AWS options.

**How to treat them:**

- **One secret per purpose and per environment.** Staging must not hold production keys. A leaked staging key should be harmless.
- **Least privilege.** A restricted Stripe key that can only create Checkout sessions; a database role that cannot drop tables.
- **Plan for rotation.** Support two valid signing keys at once (the `kid` header for JWTs, an array of cookie secrets) so you can rotate without logging everyone out.
- **Keep them out of logs and errors.** Do not log whole config objects, request headers or environment dumps. Redact `authorization` and `cookie` headers in your logger.
- **Validate at start-up** (module 2's typed config), so a missing secret fails the deploy, not the first payment.

**Scanning.** Turn on push protection and secret scanning in your git host, and run a scanner such as gitleaks in CI or a pre-commit hook. These catch most mistakes before they leave your laptop.

## When a key leaks to git

Assume it is already compromised. Bots scan public pushes within minutes, and private repositories get cloned, forked and backed up. In order:

1. **Revoke or rotate the key at the provider, now.** Issue a new one, deploy it, then revoke the old one. This is the only step that actually stops misuse.
2. **Check for misuse**: the provider's logs and dashboards for calls you did not make, new users or keys created, cloud resources started, data exported.
3. **Remove it from the code**: move it to the secret manager and commit the change.
4. **Optionally clean history** with `git filter-repo` and a force-push, coordinating with everyone who has a clone. This reduces future exposure but is not a fix: copies already exist.
5. **Prevent the repeat**: add the scanner or push protection that would have caught it, and write a short blameless note on how it happened.

Deleting the file in a new commit does nothing; the key is still in history. And never skip step 1 because the repository is private.

## Common mistakes

- Taking `tenantId` from the request body or a header.
- A list endpoint that filters by tenant while the detail endpoint does not.
- Cache keys or file paths without the tenant.
- The app connecting as the table owner or a superuser, so RLS never applies.
- `SET app.tenant_id` at session level on a pooled connection.
- Secrets in Docker images, CI logs or error messages.
- Responding to a leaked key by rewriting history and not rotating it.

## Go deeper

- [PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): how policies apply, owners, `FORCE` and `BYPASSRLS`.
- [OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html): isolation patterns beyond the database.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html): storage, rotation and detection.
- [GitHub: Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository): history rewriting, and why rotation comes first.
- [Node.js: Environment variables](https://nodejs.org/api/environment_variables.html): `--env-file` and `process.loadEnvFile()`.
