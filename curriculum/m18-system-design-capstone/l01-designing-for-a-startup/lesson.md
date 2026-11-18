---
title: Designing for a startup
skills: [sd-requirements-estimates]
---

Most system design material is written by and for companies with thousands of engineers. A startup has a different scarce resource: not machines, but people and time. This lesson gives you the habits that produce designs a team of three to ten can build this quarter and still run next year: write requirements and non-requirements, do the few numbers that matter, start from a boring default architecture, and add a component only when a named signal says so.

Module 19 teaches how to run a 45-minute design interview. This module is about the engineering underneath it, the reasoning you would use at work when the design is real and you will be on call for it.

## Requirements, and the ones you will not meet

A requirement is something the system must do or be. Split them into two lists, as you would split a React component's props from its performance budget:

- **Functional:** what users can do. "An admin invites a teammate by email." "A user uploads a receipt and sees it in the list within a few seconds."
- **Non-functional:** how well. Latency targets (p95 under 300 ms for list pages), availability (99.9% a month), durability ("we never lose an uploaded file"), consistency ("a teammate removed from the workspace loses access at once"), retention, compliance, cost ceilings.

Non-functional requirements drive the architecture. "Never lose an upload" forces object storage with durable writes and a record of every upload. "Removed users lose access at once" rules out long-lived tokens without a revocation check.

Then write the third list that most designs forget: **non-requirements**. These are things a reasonable person might expect that you are deliberately not doing:

- No multi-region deployment. One region, several availability zones.
- No offline mode in the mobile app.
- No real-time collaboration on the same document; last write wins, with a conflict warning.
- Availability of 99.9%, not 99.99%.

Each line removes a whole class of work. Writing it down turns an accident into a decision that a reviewer can challenge, and stops the design growing during review.

## The numbers that matter

You need three kinds of numbers: **request rates**, **data sizes**, and **cost**. Round aggressively; the goal is the order of magnitude.

Take a B2B SaaS for small accounting firms. 2,000 customer firms, 20,000 users, about half active on a working day.

```text
Requests
  10,000 active users × 300 API calls per day      = 3,000,000 calls/day
  3,000,000 / 86,400 s (call it 100,000)           ≈ 30 requests/s average
  Working-hours peak, × 5 to 10                    ≈ 150 to 300 requests/s

Rows
  50,000 new documents/day × 2 KB of metadata      = 100 MB/day ≈ 40 GB/year

Files
  50,000 uploads/day × 1 MB average                = 50 GB/day ≈ 18 TB/year
```

Now read the numbers back and draw conclusions. 300 requests per second is comfortable for two or three Node instances and one Postgres. 40 GB of rows a year fits one Postgres instance for many years. 18 TB of files a year must not live in Postgres; it goes to object storage, and storage cost becomes a line in the budget, so lifecycle rules (module 9) matter early.

Keep a table of rough capacity figures in your head. They depend on hardware and query shape, so treat them as "is this obviously fine or obviously not":

| Component | Rough capacity on modest hardware |
| --- | --- |
| One Node process, light JSON endpoints | hundreds to a few thousand requests/s |
| Postgres, indexed single-row reads | thousands to tens of thousands/s |
| Postgres connections | `max_connections` defaults to 100; each one is a server process |
| Valkey, simple commands | around 100,000 operations/s |
| S3 | at least 3,500 writes and 5,500 reads per second per key prefix, unlimited storage |

**Cost** is the number engineers skip. Two habits help. First, price the big items: database instance, file storage and egress, and any per-request service. Second, compare them with people: one engineer-month costs more than the whole infrastructure bill of most early SaaS products. A design that saves $200 a month and costs a week of engineering per quarter is a bad trade.

## The boring default architecture

Unless the numbers say otherwise, start here:

```text
              ┌──────── CDN (static frontend, public files)
Browser ──────┤
Mobile  ──────┴──► Load balancer ──► API (NestJS, 2+ stateless instances)
                                       │        │          │
                                       ▼        ▼          ▼
                                   Postgres   Valkey    Object storage (S3)
                                   (managed,  (queue,    (uploads, exports)
                                   backups,   cache)
                                   PITR)        ▲
                                                │
                                    Worker (same codebase, separate process)
                                       │
                                       ▼
                         Email provider, Stripe, other APIs
```

Why each piece:

- **One API, one codebase.** A modular monolith (lesson 6) gives you one deploy, one log stream and in-process calls that cannot time out. Two instances, not one, so a crash or a deploy does not take you down.
- **Postgres** is the source of truth. It gives you transactions, constraints, joins, full-text search (module 3) and JSONB for the odd flexible field. Managed, with automated backups and point-in-time recovery.
- **A queue** (BullMQ on Valkey, or SQS) for work that is slow, retried or scheduled (module 7). The worker runs the same code with a different entry point.
- **Object storage** for files, uploaded straight from the browser with presigned URLs (module 9).
- **Managed everything.** A PaaS or a container service (module 16 explains why not Kubernetes yet).

This is not a toy. Plenty of companies run millions of users on this shape with a bigger database.

## Signals that justify a new component

Every box you add needs deploying, monitoring, upgrading, securing and understanding at 3 a.m. So each one needs a reason you can point at, ideally a measurement.

| Component | Add it when | Not a reason |
| --- | --- | --- |
| Cache (Valkey) | The same expensive read is served many times and you measured it is the bottleneck after fixing queries and indexes | "Caches make things fast" |
| Read replica | Database CPU is dominated by reads you cannot cache, or reports and exports hurt the primary | Lag-sensitive reads, or one slow query |
| Queue and worker | Work is slow, calls an unreliable third party, needs retries, arrives in bursts or runs on a schedule | Work that takes 20 ms and must succeed for the response to make sense |
| Search engine | Relevance tuning, facets or volume beyond what Postgres full-text search handles well | "Search is a feature" |
| Event log (Kafka) | Several independent consumers need to replay a high-volume stream (module 17) | One producer and one consumer |
| Separate service | Different scaling profile, team ownership, security boundary or runtime (lesson 6) | "Cleaner code" |
| Second region | A contract, a regulator or measured latency for distant users | "What if AWS goes down" |

When you present a design, name the signal for each component you did *not* add yet. "No cache in v1. We add one when the dashboard endpoint's p95 passes 300 ms after indexing" is a stronger design than one with a cache.

## What breaks first at 10x

This is the most common follow-up question, at work and in interviews. Answer it by walking the request path with the numbers multiplied, and comparing each step with its limit:

1. **API instances:** 3,000 requests/s instead of 300. Add instances; they are stateless.
2. **Database connections:** 10 instances × a pool of 20 is 200 connections, over the default limit. You need a pooler (lesson 3).
3. **Hot queries and rows:** the dashboard aggregate that took 40 ms now runs ten times as often. A counter row updated on every upload becomes a lock queue.
4. **Third-party limits:** your email provider's rate limit or Stripe's API limits.
5. **Workers:** the queue grows faster than it drains, so jobs wait minutes.
6. **Storage cost:** 180 TB a year is now a real bill.

The answer is rarely "rewrite". It is a short ordered list: the first two or three things that hit a limit, and the cheapest fix for each.

## Common mistakes

- Designing for a scale nobody asked for, because it is more interesting.
- Leaving non-requirements implicit, so the scope grows in every review.
- Doing the numbers and then ignoring them: a 30 requests/s system with three caches.
- Forgetting cost, or forgetting that engineering time is the largest cost.
- Adding a component without the signal that justifies it, or without saying what it costs to run.

## Go deeper

- [AWS Well-Architected: Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html): a checklist for the non-functional side of a design.
- [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/): why goals and non-goals come first.
- [PostgreSQL: Connections and Authentication settings](https://www.postgresql.org/docs/current/runtime-config-connection.html): `max_connections` and why it is low.
- [Martin Fowler: Monolith First](https://martinfowler.com/bliki/MonolithFirst.html): the case for starting with one deployable.
