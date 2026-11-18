import http from 'node:http';
import { iteratedHash, MAX_ROUNDS } from './hash.mjs';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseHashQuery(searchParams) {
  const input = searchParams.get('input');
  const rounds = Number(searchParams.get('rounds'));
  if (input === null) return { error: 'Query parameter "input" is required.' };
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    return { error: `Query parameter "rounds" must be an integer from 1 to ${MAX_ROUNDS}.` };
  }
  return { input, rounds };
}

export function createServer() {
  return http.createServer((req, res) => {
    const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { status: 'ok' });
    }

    if (req.method === 'GET' && pathname === '/hash') {
      const query = parseHashQuery(searchParams);
      if (query.error) return sendJson(res, 400, { error: query.error });

      // TODO: this call blocks the event loop for the whole computation.
      // Nothing else is served until it returns. Restructure it so that
      // /health keeps answering while a hash is being computed.
      const hash = iteratedHash(query.input, query.rounds);
      return sendJson(res, 200, { input: query.input, rounds: query.rounds, hash });
    }

    return sendJson(res, 404, { error: 'Not found' });
  });
}
