// HTTP layer: parse, call the core, map errors to status codes. Keep the rules out of here.
import { createServer } from 'node:http';
import { listTickets } from './tickets.mjs';

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendProblem(res, status, title, detail) {
  res.writeHead(status, { 'content-type': 'application/problem+json' });
  res.end(JSON.stringify({ type: 'about:blank', title, status, detail }));
}

export function createApp(tickets) {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/tickets') {
      return sendProblem(res, 404, 'Not Found', `No route for ${req.method} ${url.pathname}`);
    }
    // TODO: read status, sort, limit and cursor from url.searchParams and pass them on.
    // TODO: answer a ValidationError with a 400 problem document.
    sendJson(res, 200, listTickets(tickets));
  });
}
