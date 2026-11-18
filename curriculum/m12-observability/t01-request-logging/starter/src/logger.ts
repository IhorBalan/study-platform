// The logger and the per-request context it reads from.
import { AsyncLocalStorage } from 'node:async_hooks';
import { pino, type DestinationStream, type Logger } from 'pino';

export interface RequestContext {
  reqId: string;
}

/** Holds the current request's context for everything that runs on its behalf, across awaits. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      // TODO: add the current request's id to every line written during a request.
      // TODO: make sure passwords, Authorization headers and cookies never reach the output.
    },
    destination ?? process.stdout,
  );
}
