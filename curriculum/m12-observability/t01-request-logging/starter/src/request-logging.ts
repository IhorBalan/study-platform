// Request logging middleware. Mounted first in app.ts.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';

export function requestLogging(logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // TODO: take the request id from the x-request-id header when it is safe to reuse,
    //       or create one, and send it back in the x-request-id response header.
    // TODO: when the response is finished, write one "request completed" line with
    //       reqId, method, route, statusCode and durationMs, at a level that fits the status.
    // TODO: run the rest of the request inside requestContext, so that every line
    //       logged on its behalf carries the id.
    void logger;
    void req;
    void res;
    next();
  };
}
