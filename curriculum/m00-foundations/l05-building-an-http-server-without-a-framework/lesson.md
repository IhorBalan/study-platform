---
title: Building an HTTP server without a framework
skills: [node-http-server, graceful-shutdown, http-semantics]
---

Every Node web framework sits on `node:http`. Building one small API directly on it shows what a framework does for you, and makes its behaviour much less mysterious when something goes wrong. You will not ship servers like this, but you will debug them better.

## The server and the handler

`createServer` takes one function. Node calls it for every request, after the headers have arrived and before the body has been read.

```ts
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ method: req.method, url: req.url }));
});

server.listen(3000, '127.0.0.1');
```

`req` is a readable stream with `method`, `url` and lower-cased `headers`. `res` is a writable stream. `req.url` is only the path and query string, so parse it with `new URL(req.url, 'http://localhost')` to get `pathname` and `searchParams`. If the handler never calls `res.end`, the client waits until a timeout.

## Routing by hand

Routing is a decision on two things: the path and the method. Decide on the path first. That order gives you the correct status for free: an unknown path is `404`, a known path with the wrong method is `405` plus an `Allow` header.

```ts
const { pathname } = new URL(req.url ?? '/', 'http://localhost');
const match = /^\/notes\/([^/]+)$/.exec(pathname);

if (pathname === '/notes') {
  if (req.method === 'GET') return listNotes(res);
  if (req.method === 'POST') return createNote(req, res);
  return problem(res, 405, 'Method Not Allowed', { allow: 'GET, POST' });
}
if (match) return noteById(req, res, match[1]);
return problem(res, 404, 'Not Found');
```

## Reading and limiting a JSON body

The body arrives in chunks. You must collect it, cap its size, and only then parse it. Without a cap, one client can make the process allocate memory until it dies.

```ts
async function readJson(req: IncomingMessage, limit = 100_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new HttpError(413, 'Content Too Large');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Bad Request', 'The body is not valid JSON.');
  }
}
```

Past the limit the loop keeps reading but stores nothing. Leaving the loop early would destroy the request stream, and with it the socket you need for the `413` response. A hardened server also sends `Connection: close` and stops reading very large bodies.

Count bytes as they arrive. `Content-Length` is useful for rejecting early, but a client can omit it or send a chunked body. The function returns `unknown`: syntax is checked here (`400`), shape is checked by a schema afterwards (`422`). Check `Content-Type` too, and answer `415` if it is not JSON.

## Errors as problem details

Clients need a predictable error shape. RFC 9457 defines one, served as `application/problem+json`:

```json
{
  "type": "https://api.example.com/problems/validation",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "text must be a non-empty string",
  "instance": "/notes"
}
```

`type` is a URI that identifies the kind of problem (`about:blank` when the status code says it all). `title` is a short summary that stays the same for that type. `status` repeats the HTTP status. `detail` describes this occurrence. `instance` identifies it. You may add your own members, such as a list of field errors.

Wrap the whole handler in one `try`/`catch`. Known `HttpError`s become their status. Anything else is logged and becomes a `500` with a generic body, never a stack trace. If `res.headersSent` is already true, you can only destroy the socket.

## Graceful shutdown

Deploys stop your process with `SIGTERM`. Docker and Kubernetes then wait for a grace period and send `SIGKILL`. If you exit at once, requests in flight are cut off and clients see connection resets.

```ts
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
```

`server.close()` stops accepting new connections, closes idle keep-alive connections, and calls back when the active requests have finished. The timer is a deadline in case a request hangs; `unref()` stops it from keeping the process alive. After the server has closed, close database pools and other resources. Handle `SIGINT` the same way for Ctrl+C in development.

## Why frameworks exist

Look at what you just wrote by hand: a route table with parameters, body parsing with limits, validation, error mapping, shutdown hooks. Add authentication, logging with request ids, CORS, content negotiation and tests, and you have built a framework, one that only your team knows. Express and Fastify package the routing and middleware. NestJS, which module 2 covers, adds structure on top: modules, dependency injection, and declarative validation and error handling. The concepts are the ones from this lesson with different names. A Nest *pipe* is `readJson` plus a schema. An *exception filter* is the `try`/`catch` that writes problem details.

## Common mistakes

- Parsing JSON without a size limit, or trusting `Content-Length` instead of counting bytes.
- Returning `404` for a known path with an unsupported method, or `405` without `Allow`.
- Letting a thrown error reach the client as a stack trace, or leaving the request hanging with no response.
- Writing a response twice, which throws `ERR_HTTP_HEADERS_SENT`. Return after you respond.
- Listening on `0.0.0.0` on your laptop when `127.0.0.1` is enough, or on `127.0.0.1` inside a container, where nothing outside can reach it.
- Ignoring `SIGTERM`, so every deploy drops requests.

## Go deeper

- [Node.js HTTP API](https://nodejs.org/api/http.html): `createServer`, `IncomingMessage`, `ServerResponse`, `server.close()` and the server timeouts.
- [Anatomy of an HTTP transaction](https://nodejs.org/en/learn/modules/anatomy-of-an-http-transaction): the official walk through a request handled with `node:http`.
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457): the members of a problem document and how to extend it.
- [Node.js process signal events](https://nodejs.org/api/process.html#signal-events): which signals you can handle and what the defaults are.
