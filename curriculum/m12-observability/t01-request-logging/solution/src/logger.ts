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
      // A safety net, not the main defence: the better fix is not to pass secrets to the logger at all.
      redact: {
        paths: [
          'password',
          '*.password',
          'headers.authorization',
          'headers.cookie',
          '*.headers.authorization',
          '*.headers.cookie',
        ],
        censor: '[Redacted]',
      },
      // Runs for every line, so code deep inside a request never has to pass the id around.
      mixin() {
        const context = requestContext.getStore();
        return context ? { reqId: context.reqId } : {};
      },
    },
    destination ?? process.stdout,
  );
}
