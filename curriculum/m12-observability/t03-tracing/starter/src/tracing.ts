// The OpenTelemetry SDK set-up. Only this file and the entry point should know about
// the SDK; the rest of the code talks to @opentelemetry/api.
import { NodeTracerProvider, type SpanExporter } from '@opentelemetry/sdk-trace-node';

export function startTracing(exporter: SpanExporter): NodeTracerProvider {
  // TODO: a provider whose resource names the service "quote-api", which sends every
  //       finished span to `exporter`, registered globally with the W3C propagator.
  void exporter;
  return new NodeTracerProvider();
}
