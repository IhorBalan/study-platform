Build **Shoebox**, a small multi-tenant SaaS, in your lab repository, then write a report on what you built and how you know it works. Lesson 8 explains the product, the milestones and how to scope them; read it first. This page is the brief: the product rules, the milestones in order, and the acceptance criteria you check yourself.

There are no hidden checks. You verify each criterion with a test, a command or a screenshot, and the **report is what is reviewed**. Work in `lab/m18-system-design-capstone/t05-capstone-saas/` (or in a repository of its own, if you prefer; link it in the report).

## The product

Shoebox is a receipts inbox for small teams.

- **Workspaces** are the tenants. Signing up creates a user and a workspace in which that user is the owner.
- **Roles** per workspace:

| Role | Can do |
| --- | --- |
| owner | everything, including billing and deleting the workspace; at least one per workspace |
| admin | invite and remove members, change roles below admin, everything a member can do |
| member | upload receipts, edit and delete their own receipts, see all receipts |
| viewer | see and download all receipts and exports; cannot upload or edit (for the accountant) |

- **Receipts** are PDF, JPEG or PNG files up to 20 MB, uploaded from the browser straight to S3. A receipt has a status (`pending`, `ready`, `rejected`, `abandoned`), an optional date, amount in minor units with a currency, a category and a note.
- **Plans:** Free allows 2 members and 30 receipts per calendar month. Pro allows 15 members and 2,000 receipts per month. Pro is a Stripe subscription.
- **Monthly export:** on the 1st of each month, a CSV of the previous month's ready receipts, with links, is stored in S3 and emailed to owners and viewers.

Assume for your numbers: 500 workspaces and 3,000 users after the first year, 20,000 receipts a month, average file 1.5 MB.

A frontend is not required. An API with a short `README` showing `curl` or HTTP-file examples is enough. If you build a small UI, keep it minimal.

## Services and configuration

Use the lab services: `pnpm lab up postgres valkey aws mailpit`. Read every connection setting from environment variables and fail at start-up, with a clear message, when one is missing. Suggested names: `DATABASE_URL`, `VALKEY_URL`, `AWS_ENDPOINT_URL`, `AWS_REGION`, `S3_BUCKET`, `SMTP_HOST`, `SMTP_PORT`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_ORIGIN`.

Stripe: use test mode with a free account and `stripe listen --forward-to`, or, without an account, sign your own fixture events in tests with the Stripe SDK's `stripe.webhooks.generateTestHeaderString()` and say so in the report. Either is acceptable.

## Milestones and acceptance criteria

Do the milestones in order. Each one should leave a working product. Criteria are numbered so the report can refer to them.

### M0. Design

- **0.1** `docs/design.md`, at most five pages, with goals, non-goals, numbers (requests, storage and a rough monthly cost), data model, the numbered path of one upload and of one Stripe event, failure modes and open questions (lesson 7).
- **0.2** At least three ADRs in `docs/adr/`, including your tenancy model and your choice of session or token authentication.
- **0.3** `docs/cut-list.md` started, and kept up to date until the end.

### M1. Walking skeleton

- **1.1** A NestJS app with `GET /health/live` (process only) and `GET /health/ready` (also checks Postgres), each returning `200` or `503`.
- **1.2** Configuration is validated at start-up; removing `DATABASE_URL` makes the app exit with a message naming it.
- **1.3** Migrations create the schema from an empty database with one command, and running them again changes nothing.
- **1.4** A multi-stage Dockerfile builds an image that runs as a non-root user and answers `/health/live`.
- **1.5** `npm test` (or `pnpm test`) runs at least one integration test against a real Postgres.
- **1.6** On `SIGTERM` the app stops accepting connections, finishes in-flight requests and closes its pools.

### M2. Tenants, authentication and roles

- **2.1** Sign-up creates the user, the workspace and the owner membership in one transaction. Passwords are hashed with argon2id or scrypt.
- **2.2** Log-in creates a server-side session in a cookie with `HttpOnly`, `SameSite=Lax` and, outside local development, `Secure`. Log-out deletes the session server-side. State-changing requests are protected against CSRF.
- **2.3** Owners and admins invite by email. The invitation email arrives in Mailpit with a single-use link that expires after 72 hours; using it twice fails.
- **2.4** A roles guard enforces the table above. Tests cover every role against at least: invite, upload, delete another member's receipt, start checkout, download an export.
- **2.5** Every tenant-owned table has `workspace_id` in its primary key or a composite foreign key, and every query filters by it. A test creates two workspaces and asserts that each receipt endpoint returns `404` for the other workspace's ids.
- **2.6** A removed member loses access on their next request, with no wait.

### M3. Uploads

- **3.1** `POST /receipts/uploads` with file name, content type and size checks the role, the type, the 20 MB limit and the monthly quota, creates a `pending` receipt and returns a presigned `PUT` URL valid for at most 10 minutes. The object key is built from ids (for example `workspaces/{workspaceId}/receipts/{receiptId}`), never from the file name.
- **3.2** A file can be uploaded to the emulator with `curl -X PUT` and the returned URL, without going through the API.
- **3.3** `POST /receipts/{id}/complete` enqueues processing. Calling it twice results in one processing job.
- **3.4** The processing job checks the object exists and its size is within the limit, checks the first bytes match the declared type (`%PDF`, `FF D8 FF`, `89 50 4E 47`), computes a SHA-256 by streaming, and marks the receipt `ready` or `rejected` with a reason. A file whose hash already exists in the workspace is flagged as a possible duplicate.
- **3.5** `GET /receipts` lists receipts with cursor pagination and a month filter. `GET /receipts/{id}/download` returns a presigned `GET` URL valid for at most 5 minutes, only for `ready` receipts.
- **3.6** A scheduled job marks receipts still `pending` after 24 hours as `abandoned` and deletes their objects.

### M4. Background jobs and email

- **4.1** The worker is a separate entry point of the same codebase and image; API and worker run as separate processes.
- **4.2** Side effects (invitation emails, processing, exports) start from an outbox row written in the same transaction as the change. The relay enqueues with the outbox row id as job id. A test shows that a rolled-back transaction enqueues nothing and that running the relay twice enqueues once.
- **4.3** Jobs retry with exponential backoff and a maximum number of attempts. Permanently failed jobs are kept, logged with the error, and can be retried by a documented command.
- **4.4** The monthly export runs from one scheduler (for example a BullMQ job scheduler) and fans out one job per workspace. It writes the CSV to S3, and the email with a presigned link arrives in Mailpit. Running the export for the same workspace and month twice sends one email.
- **4.5** The worker shuts down gracefully: running jobs finish or are returned to the queue.

### M5. Subscriptions

- **5.1** `POST /billing/checkout` (owner only) creates a Checkout Session in subscription mode linked to the workspace.
- **5.2** `POST /webhooks/stripe` verifies the signature against the raw body and returns `400` for a missing, invalid or stale signature, changing nothing.
- **5.3** Each event id is processed at most once; a duplicate returns `2xx` with no effect.
- **5.4** Subscription events update the workspace's plan so that events arriving out of order still end in Stripe's current state (for example by retrieving the subscription, or comparing timestamps).
- **5.5** Entitlements live in your database and are read on every limit check; a Stripe outage does not affect existing subscribers. Your rules for `past_due` and for a downgrade with too many members are written in an ADR.
- **5.6** Limits are enforced: inviting beyond the member limit and uploading beyond the monthly quota fail with a clear `4xx` problem response.

### M6. Observability

- **6.1** Logs are JSON, one line per request with request id (taken from `x-request-id` or generated, and returned in the response), workspace id, user id, route, status and duration.
- **6.2** Job logs include job id, queue, attempt and outcome, and carry the request id that caused the job where there is one.
- **6.3** Passwords, session ids, Stripe secrets and presigned URLs never appear in logs. A test or a redaction config shows it.
- **6.4** A `/metrics` endpoint in Prometheus format, not reachable from the public port: request duration histogram by route and status, jobs completed and failed by queue, waiting jobs per queue, age of the oldest waiting job, and receipts processed by outcome.
- **6.5** Three alert rules written down with thresholds and what the on-call person does first: error rate, oldest job age, and webhook failures.

### M7. CI and infrastructure as code

- **7.1** A GitHub Actions workflow at the repository root runs on pull requests and on pushes to `main`, filtered to the capstone's path, with read-only token permissions, actions pinned to commit SHAs, and a concurrency group.
- **7.2** It installs with a frozen lockfile, then lints, type-checks, runs the tests against Postgres 18 and Valkey service containers, and builds the Docker image. A run is green on GitHub or with `act`.
- **7.3** OpenTofu in `infra/` creates on the emulator: the bucket with public access blocked, CORS allowing `PUT` from `APP_ORIGIN`, a lifecycle rule that aborts incomplete multipart uploads after a day and expires `exports/` after 30 days, and SSM parameters for non-secret configuration.
- **7.4** `tofu apply` followed by `tofu plan` shows no changes. The app takes the bucket name from configuration that matches the OpenTofu output. State files are not committed.

### M8. Hardening

- **8.1** A restore drill: dump the database, restore it into a new database, run a check script (row counts, newest receipt), and record how long it took.
- **8.2** A load smoke test against `GET /receipts` at a rate you justify from your numbers, with p95 latency and error rate recorded.
- **8.3** `docs/runbook.md`: deploy, roll back, re-drive failed jobs, rotate the Stripe webhook secret, restore the database.

## What to submit

A report of 1,200 to 2,000 words, pasted as your answer, with these sections:

1. **Architecture summary.** A diagram of processes and services, and the numbered paths of one upload and one Stripe event.
2. **Decisions and trade-offs.** The five or so decisions that mattered, each with the rejected alternative and what your choice costs. Link the ADRs.
3. **What was cut,** why, and what you would build next.
4. **Verification.** A table with every criterion id, `met`, `partly` or `not met`, and the test name or command that shows it.
5. **Operations.** Your alerts, your RPO and RTO and how the restore drill went, and the first thing you expect to break at 10x.
6. **Link to the commit** (or repository and commit) the report describes.

## What is assessed

Whether the system works as the brief says and the evidence shows it, whether tenancy, uploads, jobs and billing hold up under retries, duplicates and failures, whether decisions are reasoned and recorded, and whether the report is honest about what is missing. A criterion clearly marked "not met" with a reason scores better than one claimed without evidence.
