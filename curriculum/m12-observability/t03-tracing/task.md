The quote API calls a pricing service on every request. When a quote is slow, nobody can tell whether the time went to pricing or to the API. Instrument it by hand with OpenTelemetry so that one trace covers the caller, this API and the call to pricing.

## Requirements

Use only `express`, the OpenTelemetry packages in `package.json` and Node built-ins. Make the outgoing call with `fetch`.

**`src/tracing.ts`** exports `startTracing(exporter)`. It creates a `NodeTracerProvider` whose resource has `service.name` = `"quote-api"` and which sends every finished span to `exporter`, registers it globally and returns it. Only this file and `src/server.ts` may import SDK packages.

**`src/app.ts`** exports `createApp({ pricingUrl })`, which returns an Express 5 app that is not yet listening. Keep its responses as they are. It uses `@opentelemetry/api` only.

Spans for `GET /quotes/:sku`:

| Span | Kind | Parent | Attributes |
| --- | --- | --- | --- |
| `GET /quotes/:sku` | SERVER | the caller's span, if any | `http.request.method`, `http.route`, `http.response.status_code` (number) |
| `fetch-price` | CLIENT | the server span | `http.request.method`, `url.full`, `http.response.status_code` |
| `calculate-total` | INTERNAL | the server span | your choice |

Every request gets a SERVER span named `<METHOD> <route template>`.

- A valid incoming `traceparent` header is continued: same trace id, its span as the parent, its sampled flag respected. Keep the default parent-based sampler.
- The request to pricing carries a `traceparent` with the same trace id and the `fetch-price` span as the parent.
- When pricing fails (5xx or no answer), the API answers `502`. `fetch-price` gets an `exception` event and status ERROR, and so does the server span. A `404` from pricing becomes a `404` whose server span is not an error.

## Tests

Write tests in `test/*.test.ts` with an `InMemorySpanExporter` and a fake pricing server. They must pass, and fail against a copy whose pricing call loses the `traceparent`, and one whose spans never record errors.

## Submission

`src/`, `test/`, `package.json`, `tsconfig.json` and `README.md`, without `node_modules`.

## What is checked

The checks run `tsc`, call `startTracing()` with their own exporter, play the pricing service, and send requests with and without a `traceparent` (sampled and not). They compare span names, kinds, parents, attributes, statuses and events with the headers pricing received, and run your tests against two broken copies.
