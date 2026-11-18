// The quote API. GET /quotes/:sku?qty=N asks the pricing service for the unit price
// and returns the total. createApp() builds the app without listening.
import { context, propagation, SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_URL_FULL,
} from '@opentelemetry/semantic-conventions';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

export interface AppOptions {
  /** Base URL of the pricing service, without a trailing slash. */
  pricingUrl: string;
}

const tracer = trace.getTracer('quote-api');

class PriceNotFound extends Error {}

/** One SERVER span per request, continuing the caller's trace when a traceparent header came in. */
function tracingMiddleware(req: Request, res: Response, next: NextFunction) {
  const parentContext = propagation.extract(context.active(), req.headers);
  const span = tracer.startSpan(
    req.method,
    { kind: SpanKind.SERVER, attributes: { [ATTR_HTTP_REQUEST_METHOD]: req.method } },
    parentContext,
  );
  res.once('close', () => {
    const route = req.route?.path;
    if (typeof route === 'string') {
      const template = `${req.baseUrl}${route}`;
      span.updateName(`${req.method} ${template}`);
      span.setAttribute(ATTR_HTTP_ROUTE, template);
    }
    span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, res.statusCode);
    // On a server span only 5xx is an error: a 4xx is the client's mistake, not ours.
    if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  });
  context.with(trace.setSpan(parentContext, span), next);
}

function fail(span: Span, error: unknown): never {
  const err = error instanceof Error ? error : new Error(String(error));
  span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  throw err;
}

async function fetchPrice(pricingUrl: string, sku: string): Promise<number> {
  const url = `${pricingUrl}/prices/${encodeURIComponent(sku)}`;
  return tracer.startActiveSpan(
    'fetch-price',
    { kind: SpanKind.CLIENT, attributes: { [ATTR_HTTP_REQUEST_METHOD]: 'GET', [ATTR_URL_FULL]: url } },
    async (span) => {
      try {
        // Writes traceparent (and tracestate) for the span that is active now: this one.
        const headers: Record<string, string> = {};
        propagation.inject(context.active(), headers);
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
        span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, res.status);
        if (res.status === 404) throw new PriceNotFound(`no price for ${sku}`);
        if (!res.ok) throw new Error(`pricing service answered ${res.status}`);
        const body = (await res.json()) as { price?: unknown };
        if (typeof body.price !== 'number') throw new Error('pricing service sent no price');
        return body.price;
      } catch (error) {
        return fail(span, error);
      } finally {
        span.end();
      }
    },
  );
}

function calculateTotal(unitPrice: number, qty: number): number {
  return tracer.startActiveSpan('calculate-total', (span) => {
    try {
      const discount = qty >= 10 ? 0.1 : 0;
      span.setAttributes({ 'quote.qty': qty, 'quote.discount': discount });
      return Math.round(unitPrice * qty * (1 - discount) * 100) / 100;
    } finally {
      span.end();
    }
  });
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(tracingMiddleware);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/quotes/:sku', async (req, res) => {
    const sku = req.params.sku;
    const qty = Number(req.query.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) {
      res.status(400).json({ error: 'qty must be an integer from 1 to 1000' });
      return;
    }
    let unitPrice: number;
    try {
      unitPrice = await fetchPrice(options.pricingUrl, sku);
    } catch (error) {
      if (error instanceof PriceNotFound) {
        res.status(404).json({ error: `unknown sku ${sku}` });
      } else {
        res.status(502).json({ error: 'pricing is unavailable' });
      }
      return;
    }
    const total = calculateTotal(unitPrice, qty);
    res.json({ sku, qty, unitPrice, total });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  return app;
}
