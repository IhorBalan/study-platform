// One middleware that gives every request an id, runs the rest of the request inside
// that id's context and writes one summary line when the response is finished.
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { requestContext } from './logger.ts';

// A client-supplied id goes into every log line, so accept only short, plain values.
// Anything else (spaces, newlines, JSON, a megabyte of text) gets a fresh id instead.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

function requestIdFor(req: Request): string {
  const incoming = req.get('x-request-id');
  return incoming !== undefined && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** The route template ("/orders/:id"), never the raw path, so the value set stays small. */
function routeOf(req: Request): string {
  const path = req.route?.path;
  return typeof path === 'string' ? `${req.baseUrl}${path}` : 'unmatched';
}

export function requestLogging(logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const reqId = requestIdFor(req);
    const started = performance.now();
    res.setHeader('x-request-id', reqId);

    res.on('finish', () => {
      const statusCode = res.statusCode;
      const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
      const durationMs = Math.round((performance.now() - started) * 10) / 10;
      // reqId is passed explicitly: 'finish' fires from the socket, outside the request's context.
      logger[level](
        { reqId, method: req.method, route: routeOf(req), statusCode, durationMs },
        'request completed',
      );
    });

    requestContext.run({ reqId }, next);
  };
}
