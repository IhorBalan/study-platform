// The quote API. GET /quotes/:sku?qty=N asks the pricing service for the unit price
// and returns the total. createApp() builds the app without listening.
import express, { type Express, type Request, type Response } from 'express';

export interface AppOptions {
  /** Base URL of the pricing service, without a trailing slash. */
  pricingUrl: string;
}

class PriceNotFound extends Error {}

// TODO: a SERVER span for every request, continuing the caller's trace.

async function fetchPrice(pricingUrl: string, sku: string): Promise<number> {
  // TODO: a CLIENT span named "fetch-price" that sends the trace context to pricing
  //       and records failures.
  const url = `${pricingUrl}/prices/${encodeURIComponent(sku)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (res.status === 404) throw new PriceNotFound(`no price for ${sku}`);
  if (!res.ok) throw new Error(`pricing service answered ${res.status}`);
  const body = (await res.json()) as { price?: unknown };
  if (typeof body.price !== 'number') throw new Error('pricing service sent no price');
  return body.price;
}

function calculateTotal(unitPrice: number, qty: number): number {
  // TODO: an INTERNAL span named "calculate-total".
  const discount = qty >= 10 ? 0.1 : 0;
  return Math.round(unitPrice * qty * (1 - discount) * 100) / 100;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');

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
