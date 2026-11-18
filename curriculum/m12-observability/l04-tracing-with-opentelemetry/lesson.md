---
title: Distributed tracing with OpenTelemetry
skills: [distributed-tracing]
---

A metric tells you that checkout got slow. A log tells you that one checkout failed. Neither tells you that the slow part was the third of five database queries, or the call to the pricing service that itself waited on a cache. A trace does. This lesson explains spans and context propagation, the W3C header that carries a trace between services, how OpenTelemetry splits the API from the SDK, and the 2.x JavaScript SDK in code.

## Traces and spans

A **trace** is the whole journey of one request. It is made of **spans**, one per unit of work, arranged as a tree:

```text
GET /quotes/:sku                     240 ms   SERVER   quote-api
├─ fetch-price                       220 ms   CLIENT   quote-api
│  └─ GET /prices/:sku               215 ms   SERVER   pricing
│     └─ SELECT prices               205 ms   CLIENT   pricing
└─ calculate-total                     1 ms   INTERNAL quote-api
```

Each span has a trace id (shared by the whole tree), its own span id, its parent's span id, a name, a start and end time, a **kind**, a **status**, **attributes** (key-value pairs such as `http.route`) and **events** (timestamped notes, such as an exception).

The kinds say what role a span plays. **SERVER** handles an incoming request, **CLIENT** makes an outgoing one, **INTERNAL** is work inside a process, and **PRODUCER** and **CONSUMER** are the two sides of a message queue. Backends use the kinds to draw service maps and to match a CLIENT span with the SERVER span on the other side.

The frontend comparison is the browser's network waterfall, but for every hop behind your API.

## Context propagation and traceparent

For the pricing service's span to join the same trace, the quote API must tell it the trace id and which span is the parent. That is **context propagation**, and the standard header for it is W3C Trace Context's `traceparent`:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Four fields separated by dashes: the version (`00`), the 16-byte trace id, the 8-byte id of the parent span, and flags, where `01` means sampled. A second header, `tracestate`, carries vendor-specific data. A third, `baggage`, carries your own key-value pairs (a tenant id, say) to every downstream service; anything in it is visible to them, so never put secrets there.

Propagation has two halves. The server **extracts** the context from incoming headers and makes its SERVER span a child of it. The client **injects** the current context into outgoing headers. Inside the process, the "current span" must follow your code across `await`s. In Node that is `AsyncLocalStorage` again, the same mechanism as the request id in lesson 2.

Message queues need the same treatment: inject into the message's headers or attributes when publishing, extract when consuming.

## API and SDK

OpenTelemetry splits into two layers, and the split matters for how you structure code.

- **`@opentelemetry/api`** is a small, stable package with the interfaces: get a tracer, start a span, read the active context. Without an SDK registered, every call is a cheap no-op. Libraries and your application code depend only on this.
- **The SDK** (`@opentelemetry/sdk-trace-node` and friends) implements it: span processors, samplers, exporters, resource detection. Only the program's entry point sets it up.

So your service code never imports the SDK, and turning tracing off is a configuration change, not a code change.

## Setting up the SDK (2.x)

The JavaScript SDK reached 2.0 in 2025 and changed several APIs: processors are passed to the constructor, resources are built with functions, and spans report a `parentSpanContext` instead of a bare parent id. Examples written for 1.x will not compile.

```ts
// tracing.ts, imported first by the entry point
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, ConsoleSpanExporter, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'quote-api' }),
  spanProcessors: [new BatchSpanProcessor(new ConsoleSpanExporter())],
});
// Installs the provider globally, the W3C traceparent propagator and an
// AsyncLocalStorage context manager.
provider.register();
```

The **resource** describes the process that produces spans: service name, version, environment. The **span processor** decides when spans leave the process: `SimpleSpanProcessor` exports each span as it ends (fine for tests), `BatchSpanProcessor` queues them and sends them in the background (use it in production). The **exporter** decides where they go: the console, an in-memory list for tests, or OTLP to a collector.

## Manual spans

With the provider registered, application code uses the API only:

```ts
import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('quote-api');

export async function fetchPrice(baseUrl: string, sku: string): Promise<number> {
  return tracer.startActiveSpan('fetch-price', { kind: SpanKind.CLIENT }, async (span) => {
    try {
      const headers: Record<string, string> = {};
      propagation.inject(context.active(), headers); // adds traceparent for this span
      const res = await fetch(`${baseUrl}/prices/${sku}`, { headers });
      span.setAttribute('http.response.status_code', res.status);
      if (!res.ok) throw new Error(`pricing answered ${res.status}`);
      return ((await res.json()) as { price: number }).price;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

`startActiveSpan` makes the new span current inside the callback, so anything started inside becomes its child, and `inject` names it as the parent for the next service. Always end spans in `finally`: a span that never ends is never exported.

On the server side, a middleware extracts and starts the SERVER span:

```ts
app.use((req, res, next) => {
  const parent = propagation.extract(context.active(), req.headers);
  const span = tracer.startSpan(req.method, { kind: SpanKind.SERVER }, parent);
  res.once('close', () => {
    if (req.route) span.updateName(`${req.method} ${req.route.path}`);
    span.setAttribute('http.response.status_code', res.statusCode);
    if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  });
  context.with(trace.setSpan(parent, span), next);
});
```

Name spans by route template, not raw path, for the same cardinality reason as metrics. Use the **semantic conventions** for attribute names (`http.request.method`, `http.route`, `url.full`, `db.system.name`); the `@opentelemetry/semantic-conventions` package exports them as constants, and backends build their views on them. A 4xx is not an error on a SERVER span (the client made the mistake), but it is on a CLIENT span (your call failed).

## Automatic instrumentation

Writing server and client spans by hand teaches the model, but in a real service you install `@opentelemetry/auto-instrumentations-node`. It patches `http`, Express, NestJS, `pg`, ioredis, and many more, so you get spans for every request and query with no code. For an ESM application it needs a loader hook as well as `--import`, and the exact flags have changed between releases, so follow the ESM notes in the OpenTelemetry JS repository for your version.

Use both: automatic spans for the plumbing, manual spans for business steps worth seeing ("calculate-total", "reserve-stock") and attributes that only your code knows (`tenant.id`, `cart.items`).

## Sampling

Tracing every request is expensive at scale. **Head sampling** decides at the start of a trace: `TraceIdRatioBasedSampler(0.1)` keeps one trace in ten. Wrap it in `ParentBasedSampler` so every downstream service follows the caller's decision (the `01` or `00` flag). Otherwise each service samples independently and you get traces with holes.

**Tail sampling** decides after the trace is complete, so it can keep every slow or failed trace and drop most fast ones. It needs all spans of a trace in one place, which is a job for the collector.

## The collector

The **OpenTelemetry Collector** is a separate process that receives telemetry over OTLP (port 4317 for gRPC, 4318 for HTTP), processes it (batching, tail sampling, dropping attributes, adding metadata) and exports it to one or more backends: Tempo or Jaeger for traces, Prometheus for metrics, a vendor's endpoint. Your services send to the collector next to them and never need to know which vendor is behind it. Switching from a self-hosted Tempo to Grafana Cloud or Datadog becomes a collector config change.

## Connecting traces and logs

Put the trace id into every log line, with a pino mixin like the request id:

```ts
mixin() {
  const span = trace.getActiveSpan();
  return span ? { trace_id: span.spanContext().traceId, span_id: span.spanContext().spanId } : {};
}
```

Now a log search can jump to the trace, and a trace view can show the logs written during each span. Many teams drop their own request id and use the trace id for everything.

## Common mistakes

- Importing the SDK in library or service code instead of only at the entry point.
- Starting the SDK after the app's modules are loaded, so automatic instrumentation patches nothing.
- Forgetting `span.end()` on an error path.
- `SimpleSpanProcessor` in production, which exports on the request path.
- Sampling independently in each service instead of following the parent.
- Raw paths or user ids in span names.

## Go deeper

- [W3C Trace Context](https://www.w3.org/TR/trace-context/): the `traceparent` and `tracestate` headers.
- [OpenTelemetry: Node.js getting started](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/): setting up the SDK.
- [OpenTelemetry: Context propagation](https://opentelemetry.io/docs/concepts/context-propagation/): how context crosses process boundaries.
- [OpenTelemetry: Sampling](https://opentelemetry.io/docs/concepts/sampling/): head and tail sampling.
- [OpenTelemetry JS: ESM support](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md): the flags for automatic instrumentation in ESM apps.
