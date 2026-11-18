// Entry point. Tracing starts before the app is built, so every span has a provider.
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { startTracing } from './tracing.ts';
import { createApp } from './app.ts';

const provider = startTracing(new ConsoleSpanExporter());
const port = Number(process.env.PORT ?? 3000);
const pricingUrl = process.env.PRICING_URL ?? 'http://localhost:3001';

const server = createApp({ pricingUrl }).listen(port, () => {
  console.log(`listening on http://localhost:${port}, pricing at ${pricingUrl}`);
});

process.once('SIGTERM', () => {
  server.close(() => void provider.shutdown());
});
