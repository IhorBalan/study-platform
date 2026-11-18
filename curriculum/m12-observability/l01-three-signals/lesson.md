---
title: Why observability, and the three signals
skills: [obs-signals]
---

In development you have a debugger, a console and a single user: you. In production you have thousands of users, several instances, and no way to pause anything. Observability is how a running system answers questions you did not think of in advance: why is this one customer's checkout slow, which deploy made errors go up, is the database or our code the bottleneck. This lesson sets out the three signals you will build in the rest of the module and what each one is good for.

## Monitoring and observability

**Monitoring** watches for problems you know about: the error rate is above 1%, the disk is 90% full. **Observability** is the property that lets you investigate problems you did not predict, from the outside, without shipping new code. In practice you need both. Monitoring tells you *that* something is wrong; observability helps you find *what* and *why*.

The frontend comparison is useful. Your browser DevTools give you a network panel (what happened to each request), a performance panel (where time went) and a console (what the code said). Backend observability gives you the same three views, but for code you cannot attach a debugger to, aggregated across every user.

## The three signals

### Logs: what happened

A log line is a timestamped record of one event: "user 42 signed up", "payment provider returned 502". Logs have the most detail and answer questions about one specific request or user. Their weakness is volume. A service handling 300 requests per second with five lines per request writes 130 million lines a day. You cannot read them; you search and filter them.

Logs must be **structured**: JSON objects with fixed field names, not sentences. `{"level":50,"msg":"payment failed","orderId":"o_81","provider":"stripe","status":502}` can be filtered by `provider` and counted by `status`. "Payment for o_81 failed (stripe, 502)" can only be grepped.

### Metrics: how much and how often

A metric is a number measured over time: requests per second, p99 latency, memory used, queue depth. Metrics are cheap. A counter costs the same whether it counts ten requests or ten million, because only the running total is stored and scraped every 15 seconds or so. That makes them the right tool for dashboards and alerts, and for questions about trends: "is latency higher than yesterday?".

The price is detail. A metric can tell you that 2% of requests to `/orders/:id` failed in the last five minutes. It cannot tell you which orders.

### Traces: where the time went

A trace follows one request through every service and component it touches. It is a tree of **spans**: the API's handler, the database query inside it, the HTTP call to the pricing service, the query inside *that*. Each span has a start, a duration, attributes and a parent. A trace answers "this request took 2.4 seconds; 1.9 of them were spent waiting for a database connection."

Traces are the most expensive signal to collect and store, so most systems keep only a sample, for example one request in ten, plus the slow and failed ones when the tooling allows it.

### How they work together

A typical investigation moves between the three:

1. An **alert** on a metric fires: p99 latency for `GET /orders` is above 1 s.
2. The **dashboard** shows when it started and which routes are affected.
3. You open an example **trace** from that window and see where the time goes.
4. The trace id takes you to the **logs** of that exact request, with the error and its context.

That chain only works if the signals share identifiers. A request id in every log line, a trace id in logs and traces, the same route names in metrics and spans. Lesson 2 and lesson 4 build those links.

## Cardinality

**Cardinality** is the number of distinct values a field can take. `status_code` has a few dozen. `route` has as many as you have routes. `user_id` has as many as you have users.

It matters most for metrics. Every unique combination of label values is a separate **time series** that the metrics database keeps in memory. A counter labelled with `route` and `status_code` might have 200 series. Add `user_id` and it has 200 times your user count. That is how teams accidentally take down their Prometheus or receive a surprise invoice from a hosted vendor.

The rule of thumb:

| Kind of value | Metric label | Log field | Span attribute |
| --- | --- | --- | --- |
| Route template, method, status | yes | yes | yes |
| User id, order id, request id | no | yes | yes |
| Raw URL with ids and query string | no | careful (it may hold tokens) | yes, usually redacted |

Logs and traces handle high cardinality well because each event is stored on its own. Metrics do not.

## What it costs

Observability is not free, and small teams feel the bill.

- **Logs** are priced by volume ingested and retained. Debug logging left on in production is the classic budget leak.
- **Metrics** are priced by active series. Cardinality is the cost driver, not traffic.
- **Traces** are priced by spans or bytes. Sampling is the lever.
- **Your time** is the biggest cost of a self-hosted stack: upgrades, storage, retention and the occasional night it breaks.

## What to instrument first in a small product

You do not need everything on day one. A sensible order for a product with one API and one database:

1. **Structured logs with a request id**, and errors logged with their stack. This costs an afternoon and pays off the first time a customer reports a problem.
2. **Error tracking** (lesson 7). Every unhandled exception grouped, with a stack trace and a count, sent to your inbox.
3. **The RED metrics** for every route: rate, errors, duration (lesson 3). One dashboard, one or two alerts.
4. **Runtime metrics**: event-loop lag, heap used, database pool usage (lessons 3 and 6).
5. **Tracing**, once more than one service or a slow dependency is involved (lesson 4).
6. **SLOs and burn-rate alerts** once you have real traffic and know what "good" looks like (lesson 5).

A health check endpoint and an uptime monitor from outside your infrastructure sit alongside step 1. They are the alert that fires when everything else is down too.

## Common mistakes

- Logging sentences instead of structured fields, then trying to grep across instances.
- Putting user ids, emails or raw paths into metric labels.
- Collecting all three signals with no shared ids, so you cannot jump from an alert to the request that caused it.
- Starting with a dashboard of fifty panels instead of four that answer "are users happy?".
- Sending everything at full volume to a hosted vendor and finding out about cardinality from the invoice.

## Go deeper

- [OpenTelemetry: Observability primer](https://opentelemetry.io/docs/concepts/observability-primer/): the vocabulary of signals, spans and telemetry.
- [Google SRE book: Monitoring distributed systems](https://sre.google/sre-book/monitoring-distributed-systems/): the four golden signals and symptom-based monitoring.
- [Prometheus: Metric and label naming](https://prometheus.io/docs/practices/naming/): naming conventions and the cardinality warning.
- [OpenTelemetry: Signals](https://opentelemetry.io/docs/concepts/signals/): how traces, metrics and logs relate in the standard.
