// The accounts and orders API. createApp() builds it without listening, so tests and
// checks can pass their own log destination and start it on any port.
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { DestinationStream } from 'pino';
import { createLogger } from './logger.ts';
import { requestLogging } from './request-logging.ts';

export interface AppOptions {
  /** Where log lines go. Default: stdout. */
  destination?: DestinationStream;
}

export function createApp(options: AppOptions = {}): Express {
  const logger = createLogger(options.destination);
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogging(logger));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/signup', (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }
    const user = { id: randomUUID(), email };
    logger.info({ user: req.body }, 'user signed up');
    res.status(201).json(user);
  });

  app.get('/orders/:id', async (req, res) => {
    const orderId = req.params.id;
    if (!/^\d+$/.test(orderId)) {
      res.status(404).json({ error: 'order not found' });
      return;
    }
    logger.info({ orderId }, 'loading order');
    await sleep(15 + Math.floor(Math.random() * 20)); // stands in for a database query
    logger.info({ orderId }, 'order loaded');
    res.json({ id: orderId, total: Number(orderId) * 10 });
  });

  app.get('/boom', async () => {
    await sleep(5);
    throw new Error('boom');
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use((err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err.status === 'number' && err.status >= 400 ? err.status : 500;
    if (status >= 500) logger.error({ err, headers: req.headers }, 'unhandled error');
    res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
  });

  return app;
}
