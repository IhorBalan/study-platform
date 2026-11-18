// The OpenTelemetry SDK set-up. Only this file and the entry point know about the SDK;
// the rest of the code talks to @opentelemetry/api, which is a no-op until a provider is registered.
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeTracerProvider, SimpleSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export function startTracing(exporter: SpanExporter): NodeTracerProvider {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'quote-api' }),
    // SimpleSpanProcessor exports each span as it ends, which suits tests and the console.
    // In production use BatchSpanProcessor, so exporting never sits on the request path.
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  // Installs the provider globally, the W3C trace-context propagator and an
  // AsyncLocalStorage context manager, so the active span follows awaits.
  provider.register();
  return provider;
}
