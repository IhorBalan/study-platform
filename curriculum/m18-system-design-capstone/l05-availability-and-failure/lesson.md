---
title: Availability, failure and recovery
skills: [sd-availability]
---

Every part of a system fails eventually: an instance runs out of memory, a deploy ships a bug, the database fails over, a provider has an outage, someone runs a `delete` without a `where`. A good design does not prevent all of that. It decides in advance what each failure does to users, how you find out, and how you get back. This lesson turns that into a routine you can apply to any diagram.

## What the availability numbers mean

Availability targets are easier to reason about as time:

| Target | Downtime allowed in a 30-day month |
| --- | --- |
| 99% | about 7 hours |
| 99.9% | about 43 minutes |
| 99.95% | about 22 minutes |
| 99.99% | about 4 minutes |

Two lessons hide in that table. First, each extra nine costs far more than the last: 99.99% leaves no time for a human to wake up, so everything must fail over automatically. For most startups 99.9% is honest and enough. Second, dependencies in series multiply. If a request needs the API, Postgres and an auth provider, each at 99.9%, the request succeeds about 99.7% of the time: two hours of downtime a month, not 43 minutes. Every synchronous dependency you add lowers your ceiling.

## Find the single points of failure

A single point of failure (SPOF) is any component whose failure takes the whole product down. Walk the diagram box by box and ask "what if this one disappears now?":

- **One API instance.** A crash or a deploy is an outage. Run two or more behind a load balancer.
- **One database server with no standby.** A hardware failure means restoring from backup: hours of downtime and lost recent writes.
- **Valkey holding the job queue.** If it restarts without persistence, queued jobs vanish. Either turn on persistence and use a managed service with a replica, or make jobs re-creatable from Postgres (the outbox makes this possible).
- **One availability zone.** Everything above in one data centre.
- **The cron box.** One VM that runs the nightly jobs and nobody remembers.
- **A third party in the request path.** If login calls an external API synchronously, its outage is your outage.
- **People and secrets.** Only one engineer can deploy; the production database password lives on one laptop.

You do not have to remove every SPOF. You have to know them, and decide which ones are acceptable for now.

## Multi-AZ in plain words

A cloud **region** (for example `eu-central-1`) contains several **availability zones**: separate data centres a few kilometres apart, with their own power and networking, connected by fast links. They rarely fail together.

Running **multi-AZ** means:

- API instances spread over at least two zones behind the load balancer, which stops sending traffic to an unhealthy zone.
- A managed database with a **standby in another zone**, kept up to date with synchronous replication. If the primary's zone fails, the provider promotes the standby and moves the DNS name. Connections drop during the switch, which takes on the order of a minute, and your app must reconnect.
- Managed Valkey with a replica in another zone, and object storage, which is already spread across zones by the provider.

For a startup, multi-AZ is usually a setting and a bigger bill, not a project. Multi-region is a project: data replication across long distances, failover of DNS, and a second copy of everything. Do it when a contract or regulator requires it.

## Health checks that tell the truth

A load balancer or platform sends traffic only to instances that pass a health check. Module 14 covers the details:

- **Liveness:** is the process working at all? Keep it shallow. If it checks the database, a database blip restarts every instance at once.
- **Readiness:** should this instance receive traffic now? It may check that start-up finished and that the instance can reach its critical dependencies.
- On `SIGTERM`, fail readiness, finish in-flight requests, then exit.

## Timeouts and degraded modes

The most common way a small failure becomes a big one: a dependency gets slow, requests wait on it without a timeout, every worker and connection fills up, and the healthy parts of the system stop responding too. Module 8 covers timeouts, retries with backoff and circuit breakers. In a design, the decision is per dependency: **what does the user see while it is down?**

| Dependency down | Degraded behaviour |
| --- | --- |
| Email provider | Emails queue and are retried for hours; nothing user-facing fails |
| Stripe | Existing subscribers keep access (entitlements are in your database); new checkouts show "try again in a few minutes" |
| Search engine | Fall back to a simple Postgres filter, or hide search |
| Valkey cache | Read from Postgres, slower; protect it from a stampede |
| Read replica | Route reads to the primary if it has headroom, or pause reports |
| Postgres primary | Read-only mode from a replica if built for it; otherwise a clear maintenance page |

A design that writes this table down is far ahead of one that discovers it during an incident.

## Backups, RPO and RTO

Two numbers frame recovery:

- **RPO (recovery point objective):** how much data you can afford to lose, measured in time. "At most 5 minutes of writes."
- **RTO (recovery time objective):** how long you can afford to be down while recovering. "Back within 1 hour."

They are business decisions with technical consequences. A nightly `pg_dump` gives an RPO of up to 24 hours. **Point-in-time recovery** (a base backup plus continuously archived write-ahead log) gives an RPO of minutes or less and lets you restore to just before the bad `delete`. Managed Postgres offers it as a setting with a retention window. A standby in another zone gives near-zero RPO for hardware failure, but it faithfully replicates your accidental `delete` too: **replicas are not backups**.

For files, turn on object versioning or keep deletes soft for a period, so a bug that deletes files can be reversed.

A backup you have never restored is a hope, not a backup. Run a **restore drill** on a schedule, for example quarterly:

1. Restore the latest backup, or a point in time, into a new, separate instance.
2. Run a check script: row counts of key tables, the newest `created_at`, a sample of tenants.
3. Record how long it took. That is your real RTO.
4. Write down what was surprising, and fix the runbook.

## Disaster recovery strategies

From cheapest to most expensive, roughly as AWS names them:

1. **Backup and restore.** Backups in another region; rebuild everything there if the region is lost. RTO in hours. Infrastructure as code (module 15) is what makes "rebuild everything" possible.
2. **Pilot light.** Data replicated to a second region, compute switched off until needed.
3. **Warm standby.** A scaled-down copy running in the second region.
4. **Multi-site active/active.** Full capacity in two regions.

Most startups should do the first one well before considering the second.

## Common mistakes

- Treating a replica or a standby as a backup.
- Never testing a restore, so the RTO is unknown.
- A liveness check that depends on the database.
- No timeout on a third-party call in the request path.
- Promising 99.99% without automatic failover or anyone on call.
- Forgetting that the queue in Valkey and the files in the bucket also need a recovery story.

## Go deeper

- [PostgreSQL: Continuous Archiving and Point-in-Time Recovery](https://www.postgresql.org/docs/current/continuous-archiving.html): how PITR works underneath the managed setting.
- [Amazon RDS: Multi-AZ deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html): what a managed standby does and does not give you.
- [AWS: Disaster recovery options in the cloud](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html): the four strategies with RPO and RTO trade-offs.
- [Google SRE book: Embracing Risk](https://sre.google/sre-book/embracing-risk/): why 100% is the wrong target and how error budgets work.
