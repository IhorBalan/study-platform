// The orders API. createApp() builds it without listening, so tests and checks can
// start as many copies as they like on any port.
import { setTimeout as sleep } from 'node:timers/promises';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createMetrics, metricsMiddleware } from './metrics.ts';

export function createApp(): Express {
  const metrics = createMetrics();
  const app = express();
  app.disable('x-powered-by');

  // TODO: serve GET /metrics in the Prometheus text format.

  app.use(metricsMiddleware(metrics));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/orders/:id', (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
      res.status(404).json({ error: 'order not found' });
      return;
    }
    res.json({ id: req.params.id, total: Number(req.params.id) * 10 });
  });

  app.post('/orders', (req, res) => {
    res.status(201).json({ id: String(Date.now()), ...req.body });
  });

  app.get('/reports/:id', async (req, res) => {
    await sleep(300); // a slow aggregate query
    res.json({ id: req.params.id, rows: 3 });
  });

  app.get('/fail', async () => {
    throw new Error('the database is down');
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use((_err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
