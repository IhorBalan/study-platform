import type { IncomingMessage, ServerResponse } from 'node:http';

/** Host names the API answers to: this machine, plus the host of the web app's origin. */
export function allowedHosts(webOrigin: string): Set<string> {
  return new Set(['localhost', '127.0.0.1', '[::1]', new URL(webOrigin).hostname]);
}

/** "localhost:3000" -> "localhost", "[::1]:3000" -> "[::1]". */
function hostname(header: string): string {
  return header.replace(/:\d+$/, '').toLowerCase();
}

/**
 * Refuses requests whose Host header is not this machine.
 *
 * Binding to loopback keeps other machines out, but not other web pages: a
 * site whose domain is re-pointed at 127.0.0.1 (DNS rebinding) is "same origin"
 * with the API in the browser's eyes and could read settings, cards and
 * answers. Such a request still carries the attacker's domain in Host.
 */
export function hostGuard(webOrigin: string) {
  const hosts = allowedHosts(webOrigin);
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (hosts.has(hostname(req.headers.host ?? ''))) return next();
    res.writeHead(403, { 'content-type': 'application/problem+json' });
    res.end(
      JSON.stringify({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'The API only answers requests addressed to this machine.',
      }),
    );
  };
}
