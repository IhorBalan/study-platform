// HTTP layer: parse, call the core, map errors to status codes. Keep the rules out of here.
import { createServer } from 'node:http';
import { listTickets, ValidationError } from './tickets.mjs';

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendProblem(res, status, title, detail) {
  res.writeHead(status, { 'content-type': 'application/problem+json' });
  res.end(JSON.stringify({ type: 'about:blank', title, status, detail }));
}

/** Query strings are text. Only limit needs a type; the core validates the rest. */
function parseQuery(params) {
  const options = {};
  if (params.has('status')) options.status = params.get('status');
  if (params.has('sort')) options.sort = params.get('sort');
  if (params.has('cursor')) options.cursor = params.get('cursor');
  if (params.has('limit')) {
    const raw = params.get('limit');
    // Number() would accept '' and '1e1', and parseInt() would accept '10abc'.
    if (!/^\d{1,3}$/.test(raw)) throw new ValidationError('limit must be a whole number from 1 to 100');
    options.limit = Number(raw);
  }
  return options;
}

export function createApp(tickets) {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/tickets') {
      return sendProblem(res, 404, 'Not Found', `No route for ${req.method} ${url.pathname}`);
    }
    try {
      sendJson(res, 200, listTickets(tickets, parseQuery(url.searchParams)));
    } catch (error) {
      if (error instanceof ValidationError) {
        return sendProblem(res, 400, 'Bad Request', error.message);
      }
      console.error(error);
      sendProblem(res, 500, 'Internal Server Error', 'Something went wrong.');
    }
  });
}
