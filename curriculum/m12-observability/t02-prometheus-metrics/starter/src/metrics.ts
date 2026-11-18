// The service's metrics. Read the task brief for the names, labels and buckets.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Registry } from 'prom-client';

export interface Metrics {
  registry: Registry;
  // TODO: the request counter, the duration histogram and the in-flight gauge.
}

export function createMetrics(): Metrics {
  // A registry per app, not prom-client's global default one.
  const registry = new Registry();
  // TODO: default process and runtime metrics, and the three HTTP metrics.
  return { registry };
}

export function metricsMiddleware(metrics: Metrics): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // TODO: count and time every request, labelled with method, route template and status code.
    void metrics;
    void req;
    void res;
    next();
  };
}
