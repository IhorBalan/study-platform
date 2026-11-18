---
title: Writing a design doc and running a design review
skills: [sd-design-docs]
---

At a startup, most design happens in a document, not on a whiteboard. A short design doc lets you think a problem through before writing code, lets teammates review it on their own time, and leaves a record of why the system looks the way it does. This lesson gives you a structure for a short doc, shows how to present trade-offs and record decisions as ADRs, and how to review someone else's design usefully.

## When to write one

Write a design doc when a change is **hard to reverse** (a data model, a public API, a new vendor), **crosses module or team boundaries**, or **will take more than a week or two**. Do not write one for a change you could revert in an afternoon; a good pull request description is enough.

Think of one-way and two-way doors. A two-way door (a feature flag, an internal endpoint) can be walked back cheaply, so decide fast. A one-way door (a tenancy model, a payment provider's data in your schema, a public webhook format) deserves a page of thought.

## The structure of a short design doc

Two to five pages. A reviewer should be able to read it in fifteen minutes.

```markdown
# Scheduled exports (design)
Author, date, status: draft | in review | accepted | superseded

## Context
What exists today and what problem we are solving. Two paragraphs.

## Goals
- Customers schedule CSV exports daily or weekly, delivered by email link.

## Non-goals
- No custom export formats. No delivery to customer S3 buckets in v1.

## Numbers
Schedules, runs per day, peak runs per minute, data per run, storage per month, cost.

## Design
Diagram. API changes. Data model (tables, keys, indexes).
The path of one export from schedule to email.

## Alternatives considered
Each with why it lost. A trade-off table.

## Failure modes and operations
What fails, how we notice (metrics, alerts), what the user sees, how we recover.
How we deploy and migrate. How we roll back.

## Security and privacy
Tenant isolation, who can trigger and download, retention of exported files.

## Rollout
Feature flag, migration order, first customers, success metric.

## Open questions
Things the author wants reviewers to decide or challenge.
```

The sections that make a doc valuable are the ones people skip: **non-goals**, **numbers**, **alternatives**, and **failure modes**. A doc without alternatives reads as a decision already made; reviewers then argue about details instead of direction. A doc without failure modes describes only the happy path, which is the part that rarely causes incidents.

Write the **path of one request or job** in numbered steps. It exposes missing pieces (who creates this row? what if step 3 fails?) better than any diagram.

## Trade-off tables

When there are real alternatives, put them side by side against the criteria that matter for *this* decision, and say which criteria dominate:

| Criterion | Postgres table + polling worker | BullMQ job schedulers | Hosted scheduler (EventBridge Scheduler) |
| --- | --- | --- | --- |
| 50,000 customer-defined schedules | Fine; indexed `next_run_at` | Possible; one scheduler per schedule in Valkey | Fine; one schedule per resource |
| Query "what runs next hour for tenant X" | One SQL query | Harder; data in Valkey | API calls |
| New infrastructure | None | None (Valkey exists) | New AWS service, IAM, IaC |
| Pause all schedules of a tenant | One `update` | Loop over schedulers | Loop over API calls |
| One run per occurrence | `skip locked` + unique run key | One job per occurrence; handler must still be idempotent | Delivered at least once; handler must be idempotent |

> Decision: Postgres table. The dominating criteria are queryability and tenant-level operations; the polling cost is small at our numbers.

The table forces you to compare on the same axes, and the closing line forces you to commit.

## Architecture decision records

An **ADR** records one decision in a short file in the repository, so that a new engineer can find out why the system is this way without archaeology. The common format, from Michael Nygard:

```markdown
# 7. Use a Postgres table for customer-defined schedules

Status: accepted (2026-11-18)

## Context
Customers define up to 50 schedules each; support needs to query and pause them per tenant.
BullMQ already runs our jobs, but keeps scheduler state in Valkey.

## Decision
Store schedules in `schedules` with `next_run_at`, claim due rows with
`for update skip locked`, and enqueue one BullMQ job per run.

## Consequences
+ Schedules are queryable, backed up and tenant-scoped like other data.
+ No new infrastructure.
- We own the claim loop and its monitoring.
- Polling adds a query every few seconds.
```

Rules: one decision per ADR, numbered, in `docs/adr/`. Never edit an accepted ADR's decision; write a new one that **supersedes** it, and mark the old one. The history of changed minds is the useful part.

Design docs and ADRs work together: the doc explores a change, and the decisions it settles are recorded as ADRs that outlive it.

## Running a design review

A review is a short meeting, or an asynchronous comment thread, whose purpose is to find problems while they are cheap to fix.

1. The author shares the doc at least a day ahead and names the **questions they want answered**.
2. Reviewers read it before the meeting and comment in the doc.
3. The meeting, 30 to 45 minutes, discusses only open questions and blocking concerns. It does not read the doc aloud.
4. The author records outcomes: decisions as ADRs, changes to the doc, follow-up tasks.

## How to review someone else's design

Read with a checklist, and check each item against the doc's own requirements, not your preferences:

- **Requirements and scope.** Do the goals match what the product needs? Are non-goals explicit? Is anything in the design not traceable to a requirement?
- **Numbers.** Are there any? Does the design follow from them, or is it built for a different scale?
- **Data.** Who owns each piece of data? What is the source of truth for each copy, and how stale can it be? What constraints protect the invariants?
- **Every arrow.** For each call or message: what if it is slow, fails, or happens twice? Is there a timeout, a retry policy, an idempotency key?
- **Every box.** What if it disappears? Is it a single point of failure, and is that accepted?
- **Security.** Tenant isolation on every query and cache key, authorisation on every endpoint, secrets, data retention.
- **Operations.** How is it deployed, migrated, observed and rolled back? What alerts exist?
- **Cost and team.** Can this team build and run it? What does it cost per month?
- **Left out.** What did the author decide not to do, and is that reversible later?

Then write comments that help:

- **Ask before asserting.** "What happens to queued jobs if Valkey restarts?" invites a fix. "This loses data" invites a defence. Use the assertion when you are sure and it matters.
- **Label severity.** *Blocking* (must change before building), *should* (strong suggestion), *nit* (take it or leave it). Without labels, every comment feels blocking.
- **Propose an alternative** with each blocking concern, or say clearly that you do not have one.
- **Prioritise.** Three blocking problems at the top are worth more than thirty mixed comments.

## Common mistakes

- A design doc that describes only the chosen solution, with no alternatives or failure modes.
- Ten pages nobody reads. If it is long, the problem is too big for one doc.
- Editing old ADRs instead of superseding them.
- Reviewing for personal taste ("I would use Kafka") instead of against the requirements.
- Unlabelled comments, so the author cannot tell a blocker from a nit.

## Go deeper

- [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/): the sections of a design doc and when not to write one.
- [Michael Nygard: Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions): the original ADR format.
- [ADR GitHub organisation](https://adr.github.io/): templates and tooling for decision records.
- [AWS Well-Architected: Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html): questions to ask of any design's failure handling.
