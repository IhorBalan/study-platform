Write a short design document for a multi-tenant job scheduler. Use the structure from lesson 7. Aim for 900 to 1,500 words, with a box diagram in ASCII or Mermaid, short SQL for the tables and the states a run goes through.

## The product

> **Tally** is analytics for small online shops. Customers want reports delivered on a schedule: "sales summary every Monday at 08:00", "stock below threshold every day at 07:30", "month-end revenue on the 1st at 09:00", each in the shop's own time zone. A report is delivered by email (a link to a CSV in S3) or by an HTTPS POST to a URL the customer gives.
>
> 6,000 customer shops have created 40,000 schedules. Shops are in time zones from UTC−8 to UTC+10, most in Europe. About 60% of schedules run on Monday morning between 07:00 and 09:00 local time, mostly on the hour. Generating a report takes 5 seconds to 3 minutes; reports for the 50 biggest shops take up to 15 minutes. Report queries run against a read replica of the analytics database, which can run about 40 heavy queries at once before everything slows down.
>
> The team is four engineers with a NestJS monolith, PostgreSQL 18, Valkey and BullMQ.

Requirements:

- A report starts within **5 minutes** of its scheduled time.
- A report is **never delivered twice** for the same scheduled time, and a scheduled run is **never silently skipped**.
- Customers see a **run history** (scheduled for, started, finished, delivered or failed and why) and can press **Run now** and **Pause**.
- Schedules follow the shop's **time zone, including daylight saving changes**.
- The Free plan allows 3 schedules; paid plans allow 50.
- One shop's huge reports must not delay everyone else's.

## What to cover

1. **Requirements.** Goals, non-goals, and two questions with assumed answers.
2. **Numbers.** Runs per week, peak runs in the busiest five minutes (think about which zones share an hour), and the worker concurrency needed to start every run within 5 minutes given the durations, against the replica's limit of about 40 heavy queries. Show the arithmetic.
3. **Data model.** Schedules and runs, with keys, the constraint that makes "one run per scheduled time" true, and the index the scheduler polls.
4. **Scheduling.** Where the schedule's single source of truth lives, how due runs are found and claimed by more than one process safely, how the next run time is computed in the shop's zone, and your rule for a 02:30 run on the night the clocks skip 02:00 to 03:00.
5. **Execution and fairness.** Queues, concurrency, protecting the replica, and keeping big shops from delaying small ones.
6. **Delivery without duplicates.** The states of a run, and what makes email and webhook delivery safe to retry.
7. **Failure modes.** The scheduler process down for 20 minutes at 08:55 on a Monday, a worker crash at minute 12 of a 15-minute report, the customer's webhook timing out, the replica lagging an hour, and how you would notice a run that never started.
8. **Trade-offs and what you left out,** with revisit signals.

## What is assessed

Whether the numbers produce a concurrency figure the design respects, whether one-run-per-time is enforced by a constraint rather than hope, whether time zones, DST and catch-up have explicit rules, whether big tenants are isolated, whether delivery is idempotent with a visible run history, and whether missed runs are detected. There are no automated checks.
