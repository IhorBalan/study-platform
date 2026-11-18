import type { IncomingMessage, ServerResponse } from 'node:http';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The same origin with localhost and 127.0.0.1 swapped, since both open the same app. */
export function allowedOrigins(webOrigin: string): Set<string> {
  const url = new URL(webOrigin);
  const origins = new Set([url.origin]);
  for (const [from, to] of [
    ['localhost', '127.0.0.1'],
    ['127.0.0.1', 'localhost'],
  ] as const) {
    if (url.hostname === from) {
      const twin = new URL(url.origin);
      twin.hostname = to;
      origins.add(twin.origin);
    }
  }
  return origins;
}

function problem(res: ServerResponse, status: number, title: string, detail: string): void {
  res.writeHead(status, { 'content-type': 'application/problem+json' });
  res.end(JSON.stringify({ type: 'about:blank', title, status, detail }));
}

/**
 * The API has no login, so any page open in the browser could otherwise write
 * to it with a plain HTML form. Writes must come from the web app's origin (or
 * from a tool that sends no Origin, such as curl) and must carry JSON, which a
 * cross-site form cannot send without a CORS preflight.
 */
export function writeGuard(webOrigin: string) {
  const origins = allowedOrigins(webOrigin);
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (SAFE_METHODS.has(req.method ?? 'GET')) return next();

    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      return problem(res, 403, 'Forbidden', 'Requests from this origin are not allowed.');
    }
    const hasBody =
      Number(req.headers['content-length'] ?? 0) > 0 ||
      req.headers['transfer-encoding'] !== undefined;
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (hasBody && type !== 'application/json') {
      return problem(
        res,
        415,
        'Unsupported media type',
        'Send the request body as application/json.',
      );
    }
    next();
  };
}
