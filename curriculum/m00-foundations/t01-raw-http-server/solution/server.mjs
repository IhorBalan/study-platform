import http from 'node:http';
import { randomUUID } from 'node:crypto';

export const BODY_LIMIT_BYTES = 1024;

class HttpError extends Error {
  constructor(status, detail, headers = {}) {
    super(detail ?? http.STATUS_CODES[status]);
    this.status = status;
    this.detail = detail;
    this.headers = headers;
  }
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function sendProblem(req, res, status, detail, headers = {}) {
  const payload = JSON.stringify({
    type: 'about:blank',
    title: http.STATUS_CODES[status] ?? 'Error',
    status,
    ...(detail ? { detail } : {}),
    instance: req.url,
  });
  res.writeHead(status, {
    'content-type': 'application/problem+json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

async function readJsonBody(req, limit) {
  const mediaType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new HttpError(415, 'Send the body as application/json.');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Keep consuming past the limit, but store nothing. Leaving the loop early
    // would destroy the request and the socket the 413 has to be written to.
    if (size <= limit) chunks.push(chunk);
    else chunks.length = 0;
  }
  if (size > limit) {
    throw new HttpError(413, `The body may be at most ${limit} bytes.`, { connection: 'close' });
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'The body is not valid JSON.');
  }
}

function parseNoteInput(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(422, 'The body must be a JSON object.');
  }
  if (typeof value.text !== 'string' || value.text.length === 0) {
    throw new HttpError(422, '"text" must be a non-empty string.');
  }
  return { text: value.text };
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, 'The path contains an invalid percent-encoding.');
  }
}

export function createServer() {
  /** @type {Map<string, { id: string, text: string }>} */
  const notes = new Map();

  function findNote(id) {
    const note = notes.get(id);
    if (!note) throw new HttpError(404, `There is no note with id "${id}".`);
    return note;
  }

  const routes = [
    {
      pattern: /^\/notes$/,
      methods: {
        GET: (req, res) => sendJson(res, 200, [...notes.values()]),
        POST: async (req, res) => {
          const { text } = parseNoteInput(await readJsonBody(req, BODY_LIMIT_BYTES));
          const note = { id: randomUUID(), text };
          notes.set(note.id, note);
          sendJson(res, 201, note, { location: `/notes/${note.id}` });
        },
      },
    },
    {
      pattern: /^\/notes\/([^/]+)$/,
      methods: {
        GET: (req, res, id) => sendJson(res, 200, findNote(id)),
        DELETE: (req, res, id) => {
          notes.delete(findNote(id).id);
          res.writeHead(204);
          res.end();
        },
      },
    },
  ];

  async function dispatch(req, res) {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    for (const route of routes) {
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      const handler = route.methods[req.method ?? ''];
      if (!handler) {
        throw new HttpError(405, `${req.method} is not supported here.`, {
          allow: Object.keys(route.methods).join(', '),
        });
      }
      return handler(req, res, ...match.slice(1).map(decodeSegment));
    }
    throw new HttpError(404, `Nothing is served at ${pathname}.`);
  }

  return http.createServer((req, res) => {
    dispatch(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        sendProblem(req, res, error.status, error.detail, error.headers);
        return;
      }
      console.error(error);
      sendProblem(req, res, 500);
    });
  });
}
