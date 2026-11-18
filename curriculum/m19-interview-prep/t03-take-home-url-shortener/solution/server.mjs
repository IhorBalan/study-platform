// HTTP layer: parse, call the core, map errors to status codes. No business rules here.
import { createServer } from 'node:http';
import { ConflictError, RateLimitError, ValidationError } from './shortener.mjs';

const MAX_BODY_BYTES = 16 * 1024;

class BadRequest extends Error {}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function sendProblem(res, status, title, detail, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/problem+json', ...headers });
  res.end(JSON.stringify({ type: 'about:blank', title, status, detail }));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BadRequest('body is too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadRequest('body must be valid JSON');
  }
}

function clientIdOf(req) {
  const header = req.headers['x-client-id'];
  return typeof header === 'string' && header.length > 0 ? header : (req.socket.remoteAddress ?? 'unknown');
}

function sendError(res, error) {
  if (error instanceof BadRequest || error instanceof ValidationError || error instanceof URIError) {
    return sendProblem(res, 400, 'Bad Request', error.message);
  }
  if (error instanceof ConflictError) return sendProblem(res, 409, 'Conflict', error.message);
  if (error instanceof RateLimitError) {
    return sendProblem(res, 429, 'Too Many Requests', error.message, {
      'retry-after': String(error.retryAfterSeconds),
    });
  }
  console.error(error);
  return sendProblem(res, 500, 'Internal Server Error', 'Something went wrong.');
}

export function createApp(shortener) {
  return createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'POST' && pathname === '/links') {
        const body = await readJson(req);
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          throw new BadRequest('body must be a JSON object');
        }
        const link = shortener.shorten(body.url, { clientId: clientIdOf(req), alias: body.alias });
        return sendJson(res, 201, link, { location: `/${link.code}` });
      }

      const statsMatch = /^\/links\/([^/]+)\/stats$/.exec(pathname);
      if (req.method === 'GET' && statsMatch) {
        const stats = shortener.stats(decodeURIComponent(statsMatch[1]));
        return stats ? sendJson(res, 200, stats) : sendProblem(res, 404, 'Not Found', 'No link with this code.');
      }

      const codeMatch = /^\/([^/]+)$/.exec(pathname);
      if (req.method === 'GET' && codeMatch) {
        const url = shortener.resolve(decodeURIComponent(codeMatch[1]));
        if (!url) return sendProblem(res, 404, 'Not Found', 'No link with this code.');
        res.writeHead(302, { location: url });
        return res.end();
      }

      return sendProblem(res, 404, 'Not Found', 'No such route.');
    } catch (error) {
      return sendError(res, error);
    }
  });
}
