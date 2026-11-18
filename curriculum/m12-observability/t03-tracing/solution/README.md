# Quote API tracing

```sh
npm install
npm test
npm run typecheck
PRICING_URL=http://localhost:3001 npm start
```

## Notes

**For production.** Swap `SimpleSpanProcessor` for `BatchSpanProcessor`, so spans are queued and sent in the background instead of one export per span. Swap the console exporter for an OTLP exporter (`@opentelemetry/exporter-trace-otlp-http`) that sends to an OpenTelemetry Collector next to the service; the collector batches, samples and forwards to the backend, so the app does not need to know which vendor that is. Sample at the edge with `ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.1) })`: one trace in ten is started, and every service downstream follows the caller's decision, so traces are never half recorded. Add auto-instrumentation for `http`, `express` and `pg` instead of hand-written server and client spans.

**Logs.** A pino `mixin` can read `trace.getActiveSpan()?.spanContext()` and add `trace_id` and `span_id` to every line. The log tool can then jump from an error line to the trace that shows which call was slow or failed, and from a trace back to its logs.
