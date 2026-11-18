---
title: The capstone, explained
skills: [capstone-delivery]
---

The capstone is where the modules stop being separate exercises. You build **Shoebox**, a small multi-tenant SaaS, in your lab repository: teams sign up, invite colleagues with roles, upload receipts straight to object storage, pay for a plan through Stripe, and get background processing, emails, logs, metrics, a CI pipeline and infrastructure as code. The full brief with acceptance criteria is task 5 of this module. This lesson explains why it is shaped this way, how each milestone uses what you learned, and how to scope it so that you finish.

## The product

Shoebox is a receipts inbox for small teams: a freelancer collective or a ten-person agency that needs every receipt in one place for their accountant.

- A person signs up and gets a **workspace**. They invite teammates by email. Roles: **owner** (billing, delete the workspace), **admin** (manage members), **member** (upload and edit their own receipts), **viewer** (read and export, for the accountant).
- Members **upload receipts** (PDF, JPEG or PNG, up to 20 MB) from the browser directly to S3. A background job checks each file and marks it ready or rejected, and detects duplicates.
- People list, filter and download receipts, and add a date, an amount and a category.
- The **Free plan** allows 2 members and 30 receipts a month. **Pro** allows 15 members and 2,000 receipts a month. Upgrading goes through Stripe Checkout; Stripe webhooks keep the plan in sync.
- A **monthly export** produces a CSV of the month's receipts with download links and emails it to owners and viewers.

It is deliberately ordinary. Every SaaS has tenants, roles, files, billing and jobs, and getting the ordinary parts right is what the job mostly is.

## How the milestones map to earlier modules

| Milestone | What you build | Modules you lean on |
| --- | --- | --- |
| 0. Design | A short design doc and the first ADRs | 18 (lessons 1 to 7) |
| 1. Walking skeleton | NestJS app, config, health checks, Postgres with migrations, a Dockerfile, one test | 1, 2, 3, 5 |
| 2. Tenants, auth and roles | Sign-up, sessions, invitations, a roles guard, tenant id on every query | 6 |
| 3. Uploads | Presigned uploads, confirmation, processing status, downloads, clean-up | 9 |
| 4. Background jobs and email | A worker process, outbox, retries, scheduled export, emails to Mailpit | 7, 8, 10 |
| 5. Subscriptions | Checkout, signed webhooks handled once and in any order, entitlements and limits | 10 |
| 6. Observability | Structured logs with request and tenant ids, metrics, a dashboard or queries | 12 |
| 7. CI and infrastructure as code | A CI workflow with a real database, OpenTofu for the bucket and config on the emulator | 14, 15 |
| 8. Hardening and report | Restore drill, a load smoke test, a runbook, the written report | 18 (lesson 5) |

The milestones are ordered so that each one leaves a working, deployable product. After milestone 2 you have a tiny multi-tenant app; after 3 it stores files; and so on. If you stop early, you stop with something that works.

## Scoping: how to actually finish

Capstones fail in two ways: they grow, or they stall in the first milestone polishing the skeleton. These habits prevent both.

**Build a walking skeleton first.** The thinnest version that goes end to end through every layer you will need: an HTTP request, a database write, a migration, a test, a container build. Ugly is fine. Everything after that is adding flesh to a skeleton that already walks.

**Slice vertically.** "Invite a teammate" means the endpoint, the table, the email job, the acceptance link and a test, all at once. Do not build all the tables, then all the endpoints. A vertical slice can be demonstrated; a layer cannot.

**Keep a cut list.** Next to the brief, keep a file listing what you are deliberately not doing, with one line on why. "No password reset, magic links only." "No per-user notification preferences." That list becomes the "what was cut" section of your report, and reviewers value it. Cutting is a skill, not a failure.

**Timebox each milestone.** Pick a budget before you start, for example a few evenings. When it runs out, write down what is left, decide whether it is essential, and move on. You can come back.

**Record decisions as you make them.** One ADR per real decision, written on the day (lesson 7). Reconstructing reasons a month later produces fiction.

**Fake what you do not control, honestly:**

- **Email** goes to Mailpit, the lab's fake SMTP server.
- **AWS** is the lab's emulator. Your code reads `AWS_ENDPOINT_URL`, so pointing at real AWS later is a configuration change.
- **Stripe** works in test mode with a free account and the Stripe CLI forwarding webhooks to your machine. Without an account, test the webhook path with events you sign yourself using the Stripe SDK's test header helper, as module 10's checks do, and say so in the report.

## A suggested repository layout

The capstone lives in your lab repository under `lab/m18-system-design-capstone/t05-capstone-saas/`:

```text
t05-capstone-saas/
  docs/
    design.md                 milestone 0
    adr/0001-....md           one file per decision
    runbook.md                milestone 8
  src/
    main.ts                   API entry point
    worker.ts                 worker entry point, same codebase
    modules/
      identity/  billing/  receipts/  exports/  notifications/
    platform/                 config, db, logging, metrics, queue
  db/migrations/
  test/
  infra/                      OpenTofu for the emulator
  Dockerfile
  compose.yaml                optional: your app on top of the lab services
  README.md                   how to run, test and verify each milestone
```

GitHub reads workflows only from `.github/workflows/` at the **root** of a repository. In the lab repository, put the capstone workflow there with a `paths:` filter for the capstone folder and `defaults.run.working-directory` set to it. If you would rather give Shoebox its own repository, which makes a nicer portfolio piece, put the workflow at that repository's root.

## Verifying your own work

There are no hidden checks for the capstone. Each milestone in the brief has **acceptance criteria you can verify yourself**, usually with a test, a `curl` command or a look at Mailpit or the emulator. Treat them like a pull request checklist: for each one, write in your README the command or test that proves it. The habit of proving your own work, rather than waiting for a reviewer to find problems, is the main professional skill the capstone trains.

Good evidence is specific: "`test/tenancy.e2e.test.ts` creates two workspaces and asserts that every receipt endpoint returns 404 for the other workspace's ids" beats "tenancy works".

## The report

You submit a written report of 1,200 to 2,000 words, and it is what gets reviewed. It has:

1. **Architecture summary** with a diagram: the boxes, the path of an upload, the path of a Stripe event.
2. **Decisions and trade-offs:** the five or so decisions that mattered, each with the alternative you rejected and what your choice costs. Link the ADRs.
3. **What was cut** and why, and what you would build next.
4. **Verification:** for each milestone, how you checked each acceptance criterion.
5. **Operations:** what you would alert on, your RPO and RTO and how the restore drill went.
6. **A link to the commit** the report describes.

Write it for a senior engineer who will maintain the system after you: honest about gaps, specific about evidence, short on adjectives.

## Common mistakes

- Spending most of the time on milestone 1, polishing structure before anything works end to end.
- Building layer by layer, so nothing is demonstrable until the end.
- Adding features beyond the brief instead of finishing the acceptance criteria.
- Writing ADRs and the report at the end from memory.
- Claiming a criterion is met without a test or command that shows it.
- Hiding cuts. A clearly stated cut scores better than a silently missing feature.

## Go deeper

- [NestJS: Modules](https://docs.nestjs.com/modules): the boundaries your capstone's modules rely on.
- [Stripe: Using webhooks with subscriptions](https://docs.stripe.com/billing/subscriptions/webhooks): the events and statuses your billing module must handle.
- [Amazon S3: Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html): the upload path, against the real service.
- [OpenTofu documentation](https://opentofu.org/docs/): the tool for milestone 7.
