You are on call for a small e-commerce team. It is 14:25. Support says customers see the orders page "spinning", and an alert has just fired. Work out what you would do and write it down as you would explain it to the team. 500 to 900 words, prose or lists. No code is required, but you may sketch a query or PromQL.

## The system

- The orders API: NestJS on four identical instances behind a load balancer.
- One PostgreSQL 18 database. Each instance uses a `pg` pool with `max: 10` and `connectionTimeoutMillis: 2000`.
- Metrics in Prometheus, traces in Tempo, logs in Loki, all through Grafana.

## What you see

**Deploy log:** v2.31.0 went out at 14:02. Its changelog: "Show the loyalty tier next to each order in the order list", "Upgrade pino", "Tidy config loading".

**Dashboard, 13:30 to 14:25:**

| Signal | Before 14:02 | Since 14:05 |
| --- | --- | --- |
| `GET /orders` p50 | 45 ms | 52 ms |
| `GET /orders` p99 | 180 ms | 2.4 s |
| `POST /checkout` p99 (code unchanged) | 150 ms | 900 ms |
| Requests per second, all endpoints | 310 | 305 |
| 5xx ratio | 0.1% | 1.8% |
| DB queries per second | 1,200 | 9,800 |
| DB CPU | 35% | 55% |
| Event-loop lag p99, every instance | 12 ms | 14 ms |

All four instances look the same.

**Alert at 14:20:** `DBConnectionTimeouts: rate of "timeout exceeded when trying to connect" errors > 1/s for 5m`.

**A slow trace of `GET /orders`, 2.38 s:** the server span; then `pg-pool.connect` waiting 1.9 s; then `SELECT … FROM orders WHERE customer_id = $1` (8 ms) returning 50 rows; then 50 spans `SELECT tier FROM loyalty WHERE customer_id = $1`, about 3 ms each, one after the other; then serialisation (2 ms).

## What to cover

1. **The first ten minutes.** What you do, in what order, and why.
2. **Diagnosis.** One hypothesis that explains every row of the table, the trace and the alert, including why `POST /checkout` is slower and why the p50 barely moved. Say how you would confirm it and what you would rule out.
3. **"Database connection timeout" alerts in general.** What you check first, in order, when this alert fires another day.
4. **The fix** and how you would know it works before it reaches production.
5. **Prevention.** An SLO for `GET /orders` (SLI, target, window), an alert on it that would have paged within about ten minutes of this deploy, and two more safeguards.
6. **A blameless summary** for the team channel in three to five sentences.

## What is assessed

Whether you protect users first, whether your explanation fits all of the evidence, and whether your SLO, alert and safeguards are specific enough to set up tomorrow. There are no automated checks.
