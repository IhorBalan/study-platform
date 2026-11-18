---
title: Metrics with Prometheus
skills: [prometheus-metrics]
---

Metrics are the numbers you put on a dashboard and alert on: how many requests, how many failed, how long they took, how full the connection pool is. They are cheap enough to keep for every request, forever, which no other signal is. This lesson covers the metric types, the two methods that tell you which metrics to have, how Prometheus collects them, and how to add them to a Node service with prom-client.

## Three types you will use

**Counter.** A number that only goes up: requests served, errors, bytes sent. It resets to zero when the process restarts, and the query language handles that. You never read a counter's raw value; you ask how fast it grows.

**Gauge.** A number that goes up and down: requests in flight, queue depth, heap used, open connections. It is a snapshot of now.

**Histogram.** A distribution. Each observation (say, a request that took 0.31 s) increments the counter of every **bucket** whose upper bound it fits under, plus a total `_count` and `_sum`. Buckets are cumulative: `le="0.5"` counts every request up to 0.5 s, including those already counted in `le="0.25"`.

There is also the **summary**, which computes percentiles inside the process. Prefer histograms: you cannot add up percentiles from four instances, but you can add up their buckets and then compute a percentile across all of them.

## RED and USE: what to measure

Two short checklists cover most needs.

**RED**, for anything that serves requests (an API, a queue consumer):

- **Rate**: requests per second.
- **Errors**: failed requests per second, or the share that failed.
- **Duration**: how long they took, as a distribution.

**USE**, for resources (CPU, memory, a connection pool, a disk):

- **Utilisation**: how busy it is (pool connections in use out of 10).
- **Saturation**: how much work is waiting (requests queued for a connection).
- **Errors**: failures of the resource itself (connection timeouts).

A counter labelled with the status code gives you rate and errors. A histogram gives duration. A few gauges cover USE for the pool and the event loop. Google's "four golden signals" (latency, traffic, errors, saturation) say the same thing in different words.

## How Prometheus collects

Prometheus **pulls**. Your service exposes `GET /metrics` with the current value of every series in a plain-text format, and Prometheus **scrapes** it on an interval, typically every 15 to 30 seconds:

```text
# HELP http_requests_total HTTP requests by method, route and status.
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/orders/:id",status_code="200"} 1042
http_requests_total{method="GET",route="/orders/:id",status_code="404"} 17
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1",method="GET",route="/orders/:id",status_code="200"} 990
http_request_duration_seconds_bucket{le="0.25",method="GET",route="/orders/:id",status_code="200"} 1035
http_request_duration_seconds_bucket{le="+Inf",method="GET",route="/orders/:id",status_code="200"} 1042
http_request_duration_seconds_sum{method="GET",route="/orders/:id",status_code="200"} 41.7
http_request_duration_seconds_count{method="GET",route="/orders/:id",status_code="200"} 1042
```

Each line is one **series**: a metric name plus a unique set of label values. Pull has useful side effects: if a scrape fails, Prometheus records the target as down (the `up` metric), so "the service is unreachable" is itself a signal. For short-lived jobs that may finish before a scrape, there is the Pushgateway, or you push with OpenTelemetry instead.

Prometheus finds targets from a static list, from Docker or Kubernetes service discovery, or from a file. In lesson 7 you will see a Compose file that scrapes a service.

## Labels and cardinality

Labels make metrics useful: errors per route, latency per method. They are also the main way to break a metrics system, because every new combination of label values is a new series (lesson 1).

- Use the **route template** (`/orders/:id`), never the raw path (`/orders/8231`). Map unmatched paths to one fixed value, or every scanner probing `/wp-admin.php` creates series.
- Never use user ids, emails, order ids, request ids or free text as labels.
- Keep the status code (a few dozen values) or a class (`2xx`, `5xx`).
- Normalise methods: an unknown method such as `PROPFIND` becomes `other`.

Count the cost before adding a label: routes × methods × statuses × instances. Then multiply by the number of buckets for a histogram, because each bucket is a series too.

## Percentiles from histograms

Averages hide what users feel. If 99 requests take 50 ms and one takes 5 s, the mean is about 100 ms and looks fine, while one user in a hundred waits five seconds. Use percentiles: the **p50** (median) is the typical request, the **p95** and **p99** are the slow tail. A user who loads a page that makes 20 requests is likely to hit at least one p99 request, so the tail matters more than it seems.

In PromQL:

```promql
# requests per second per route, averaged over 5 minutes
sum by (route) (rate(http_requests_total[5m]))

# share of requests that failed with a 5xx
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# p95 latency per route
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))
```

`rate()` turns an ever-growing counter into a per-second rate and copes with resets. `histogram_quantile` estimates the percentile by assuming observations are spread evenly inside a bucket. With buckets at 0.25 and 0.5 s, a p95 anywhere in that range is a guess within it. Put bucket edges near the latencies you care about, such as your SLO threshold (lesson 5).

## prom-client in a Node service

prom-client is the standard Prometheus client for Node.

```ts
import express from 'express';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const registry = new Registry();
collectDefaultMetrics({ register: registry }); // CPU, memory, GC, event-loop lag

const requests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests by method, route and status.',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});
const duration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

const app = express();
app.get('/metrics', async (_req, res) => {
  res.type(registry.contentType).send(await registry.metrics());
});
app.use((req, res, next) => {
  const end = duration.startTimer();
  res.once('finish', () => {
    const labels = { method: req.method, route: req.route?.path ?? 'unmatched', status_code: String(res.statusCode) };
    requests.inc(labels);
    end(labels); // observes the elapsed seconds
  });
  next();
});
app.get('/orders/:id', (req, res) => {
  res.json({ id: req.params.id });
});
```

Notes:

- A **registry per app** instead of prom-client's global default avoids "metric already registered" errors in tests that build the app twice.
- The route is read when the response finishes. Express sets `req.route` only after a route matches.
- Units are in the name and are base units: seconds and bytes, not milliseconds.
- The default metrics include `nodejs_eventloop_lag_seconds` and heap sizes, which lesson 6 relies on.
- Do not expose `/metrics` to the internet. Serve it on an internal port or block it at the proxy.

In NestJS, the same middleware goes into `app.use()` or a module's `configure()`, and the `/metrics` route into a controller. If you also adopt OpenTelemetry, its metrics SDK can export in the Prometheus format too, so you are not locked in either way.

## Common mistakes

- Raw paths, user ids or query strings as label values.
- Alerting on averages instead of percentiles.
- Computing a percentile per instance and averaging the results; sum the buckets first.
- Milliseconds in a metric named `_seconds`, or no unit at all.
- Buckets that do not bracket the latency you have a target for.
- `rate()` over a window shorter than two scrape intervals, which returns gaps.

## Go deeper

- [Prometheus: Metric types](https://prometheus.io/docs/concepts/metric_types/): counters, gauges, histograms and summaries.
- [Prometheus: Histograms and summaries](https://prometheus.io/docs/practices/histograms/): bucket choice and the error of `histogram_quantile`.
- [Prometheus: Querying basics](https://prometheus.io/docs/prometheus/latest/querying/basics/): PromQL selectors, ranges and functions.
- [prom-client on GitHub](https://github.com/siimon/prom-client): registries, default metrics and the API.
- [Google SRE book: Monitoring distributed systems](https://sre.google/sre-book/monitoring-distributed-systems/): the four golden signals.
