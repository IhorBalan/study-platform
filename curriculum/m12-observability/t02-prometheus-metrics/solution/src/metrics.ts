// The service's metrics. Each call to createMetrics() gets its own registry, so tests
// can build several apps in one process without "metric already registered" errors.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const LABELS = ['method', 'route', 'status_code'] as const;
const KNOWN_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export interface Metrics {
  registry: Registry;
  requests: Counter<(typeof LABELS)[number]>;
  duration: Histogram<(typeof LABELS)[number]>;
  inFlight: Gauge;
}

export function createMetrics(): Metrics {
  const registry = new Registry();
  // Process and runtime metrics: CPU, memory, GC, event-loop lag.
  collectDefaultMetrics({ register: registry });

  const requests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled, by method, route template and status code.',
    labelNames: LABELS,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Time from request arrival to response finish, in seconds.',
    labelNames: LABELS,
    // From 5 ms to 5 s. Put boundaries near the latencies you have targets for.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const inFlight = new Gauge({
    name: 'http_requests_in_flight',
    help: 'Requests that have arrived and not yet finished.',
    registers: [registry],
  });
  return { registry, requests, duration, inFlight };
}

/** The route template, never the raw path: one series per route, not one per id. */
function routeOf(req: Request): string {
  const path = req.route?.path;
  return typeof path === 'string' ? `${req.baseUrl}${path}` : 'unmatched';
}

export function metricsMiddleware(metrics: Metrics): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const stopTimer = metrics.duration.startTimer();
    metrics.inFlight.inc();
    let done = false;
    // 'close' also fires when the client disconnects before the response finishes.
    res.once('close', () => {
      if (done) return;
      done = true;
      metrics.inFlight.dec();
      const labels = {
        method: KNOWN_METHODS.has(req.method) ? req.method : 'other',
        route: routeOf(req),
        status_code: String(res.statusCode),
      };
      metrics.requests.inc(labels);
      stopTimer(labels);
    });
    next();
  };
}
