---
title: Error tracking and the hosted options
skills: [error-tracking]
---

The previous lessons built the signals. This one is about where they go. Error tracking is the one tool almost every small team adopts first, and it is usually hosted. For logs, metrics and traces you can run your own stack or pay someone, and the choice is mostly about money and time, not features. The lesson ends with a stack you can run on your own machine later.

## Error tracking

An error tracker receives every unhandled exception (and any you report by hand), groups identical ones into an **issue** by stack trace, and shows how often each happens, since which release, for which users, with the request, the breadcrumbs that led up to it and the source lines. It answers "what is broken right now, and is it new?" faster than searching logs.

The difference from logging errors is **grouping and workflow**. A log search shows 4,000 lines; the tracker shows one issue that started with release 2.31.0, affects 212 users, is assigned to someone, and reopens itself if it comes back after being marked resolved. Alerts are per issue ("new issue", "issue regressed"), which suits a small team better than an error-rate threshold.

**Sentry** is the common choice for Node and the frontend alike, so one tool covers the React app and the API. It is optional for this module because it needs an account; the Developer plan is free for one user with a monthly error quota.

### Sentry in a Node service

Sentry's Node SDK must load before the rest of your app, so that it can instrument modules as they are imported. In an ESM app that means a separate file loaded with `--import`:

```ts
// instrument.mjs
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN, // no DSN: the SDK stays disabled, which suits local dev and tests
  environment: process.env.NODE_ENV ?? 'development',
  release: process.env.GIT_SHA, // ties issues to the deploy that introduced them
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
```

```sh
node --import ./instrument.mjs dist/main.js
```

In NestJS, the `@sentry/nestjs` package adds a `SentryModule.forRoot()` to import in the root module, and a `SentryGlobalFilter` to register as an `APP_FILTER` provider when you have no catch-all filter of your own. If you do, decorate its `catch()` with `@SentryExceptionCaptured()` instead. Errors you handle yourself are reported with `Sentry.captureException(error)`.

Before you turn it on in production:

- **Scrub data.** Error events carry request headers, bodies and local variables. Keep `sendDefaultPii` off and add a `beforeSend` hook that removes anything sensitive, with the same care as log redaction.
- **Upload source maps** from CI, so stack traces point at your TypeScript, not compiled output.
- **Set the release** from the commit, so "regressed in 2.31.0" is a real statement.
- **Filter noise.** Expected 4xx errors are not issues. Report what needs a developer.

Sentry's SDK uses OpenTelemetry for its tracing in recent versions, and its traces are a reasonable start for a small team. If you later move traces elsewhere, error tracking can stay.

## Where the signals go: the options

Every option below accepts OpenTelemetry, so the instrumentation from this module stays the same whichever you choose. That is the main reason to instrument with OpenTelemetry rather than a vendor's agent.

### Self-hosted Grafana stack

**Prometheus** for metrics, **Loki** for logs, **Tempo** for traces, **Grafana** for dashboards and alerts, an **OpenTelemetry Collector** in front. All open source.

- *For:* no per-series or per-GB bill; data stays with you; the same tools as Grafana Cloud, so you can move later.
- *Against:* you run it. Storage, retention, upgrades, backups, high availability, and the monitoring of your monitoring. When the database that stores your metrics is down during an incident, you are blind. For a team of three to ten, that is easily a day a month.

Good fit: a team with operations experience, strict data residency rules, or high volume where vendor pricing hurts.

### Grafana Cloud

The same stack, hosted by Grafana Labs. Its free tier includes a monthly allowance of metric series, logs and traces with 14-day retention and a few users; beyond that, you pay for usage.

- *For:* Prometheus, PromQL and Grafana without operating them; easy to start from the free tier; no lock-in on the query languages.
- *Against:* costs follow cardinality and log volume, so the discipline from lessons 1 and 3 is now a budget issue; you still build dashboards and alerts yourself.

Good fit: most small teams that want open standards and a low start.

### Datadog

A commercial platform with metrics, logs, APM traces, real-user monitoring, error tracking and much more, behind one agent and one UI.

- *For:* the most polished all-in-one experience; strong out-of-the-box dashboards and integrations; little to assemble.
- *Against:* pricing per host plus per GB of logs, per span volume and per product, which grows quickly and is hard to predict; custom metrics with many labels are a known cost trap; moving away is work because dashboards and monitors are Datadog-specific.

Good fit: a funded team that values time over money and wants one vendor.

### Others

Honeycomb (strong at exploring high-cardinality trace data), New Relic, Elastic, and the observability built into your platform (Fly, Railway, Render and the cloud providers all show basic metrics and logs) are all reasonable. The platform's built-in view is often enough for the very first months.

### A pragmatic path for a small team

1. Platform logs plus **Sentry** from day one.
2. **Grafana Cloud's free tier** with OpenTelemetry for metrics and traces once you have users.
3. Revisit when the bill or a compliance requirement says so. Self-host only with a reason and the people to run it.

## Practise on your own

There is no observability stack in the course lab, but you can run one locally. This Compose file starts an OpenTelemetry Collector, Prometheus and Grafana. Prometheus scrapes your service's `/metrics` on port 3000 of your machine and the collector's Prometheus exporter, and the collector prints the spans it receives.

```yaml
# compose.yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.165.0
    command: ["--config=/etc/otelcol-contrib/config.yaml"]
    volumes:
      - ./otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP

  prometheus:
    image: prom/prometheus:v3.16.0
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports:
      - "9090:9090"
    extra_hosts:
      - "host.docker.internal:host-gateway"   # lets Linux reach your app on the host

  grafana:
    image: grafana/grafana:13.2.6
    volumes:
      - ./grafana-datasources.yaml:/etc/grafana/provisioning/datasources/datasources.yaml:ro
    ports:
      - "3001:3000"
```

```yaml
# otel-collector.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
exporters:
  debug:
    verbosity: basic
  prometheus:
    endpoint: 0.0.0.0:8889
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      exporters: [prometheus]
```

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
scrape_configs:
  - job_name: api
    static_configs:
      - targets: ['host.docker.internal:3000']
  - job_name: otel-collector
    static_configs:
      - targets: ['otel-collector:8889']
```

```yaml
# grafana-datasources.yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

Then:

1. `docker compose up -d`, start the metrics task's service with `npm start`, and send it traffic in a loop.
2. Open Prometheus at `http://localhost:9090`, check **Status → Targets**, and run the PromQL from lesson 3.
3. Open Grafana at `http://localhost:3001` (the first login is `admin` / `admin`), build the four-panel RED dashboard from lesson 5, and add the burn-rate rule as a Grafana alert.
4. Point an OTLP exporter (`@opentelemetry/exporter-trace-otlp-http`, default `http://localhost:4318/v1/traces`) at the collector and watch spans appear in `docker compose logs otel-collector`.
5. To go further, add Tempo for traces and Loki for logs, with Grafana data sources for both, and link them by trace id.

The image tags were current when this was written. Check each image's page and the collector's configuration docs for newer releases and changed keys before you rely on it.

## Common mistakes

- Sending error events with request bodies and headers unscrubbed.
- No release or source maps, so issues cannot be tied to a deploy or a line of TypeScript.
- Instrumenting with a vendor's proprietary agent and finding that leaving costs a rewrite.
- Self-hosting the whole stack in week one, then spending incidents debugging Prometheus.
- Choosing a vendor without estimating series count and log volume first.

## Go deeper

- [Sentry for Node.js](https://docs.sentry.io/platforms/javascript/guides/node/): set-up, ESM loading and data scrubbing.
- [Sentry for NestJS](https://docs.sentry.io/platforms/javascript/guides/nestjs/): the module, the global filter and the decorator.
- [OpenTelemetry Collector: Configuration](https://opentelemetry.io/docs/collector/configuration/): receivers, exporters and pipelines.
- [Grafana: Run Grafana in Docker](https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/): image names and configuration.
- [Prometheus: Getting started](https://prometheus.io/docs/prometheus/latest/getting_started/): running Prometheus and its first queries.
