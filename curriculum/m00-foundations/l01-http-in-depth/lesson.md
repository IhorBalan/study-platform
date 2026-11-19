---
title: HTTP in depth
skills: [http-semantics, http-caching, http-versions]
---

On the frontend, `fetch` hides most of HTTP from you. On the backend you produce the other half of the exchange, and every proxy, cache, browser and client library acts on the exact method, status code and headers you send. This lesson covers the parts of the protocol a backend developer uses every day.

## Anatomy of an exchange

A request is a method, a target, headers and an optional body. A response is a status code, headers and an optional body. In HTTP/1.1 both are plain text:

```http
POST /orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Accept: application/json
Content-Length: 27

{"sku":"A-1","quantity":2}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /orders/981
Content-Length: 46

{"id":981,"sku":"A-1","quantity":2,"paid":false}
```

Header names are case-insensitive. A blank line separates headers from the body. `Content-Length` (or chunked transfer encoding) tells the receiver where the body ends, which is what lets one connection carry many requests.

## Methods: safe and idempotent

Two properties decide what clients and intermediaries may do with a request.

- **Safe** means the request does not ask for a state change: `GET`, `HEAD`, `OPTIONS`. Crawlers, prefetchers and caches send safe requests freely.
- **Idempotent** means sending it several times has the same intended effect as sending it once: all safe methods, plus `PUT` and `DELETE`. A client or proxy may retry these automatically after a network failure.

`POST` and `PATCH` are neither. If a `POST` times out, the client cannot know whether the order was created. That is why payment APIs accept an idempotency key: it makes an unsafe operation safe to retry.

## Status codes that matter

The first digit is the family: `2xx` success, `3xx` further action needed, `4xx` the client must change the request, `5xx` the server failed.

- `200 OK`, `201 Created` (with a `Location` header), `204 No Content` (no body, common for `DELETE`).
- `301` and `308` are permanent redirects, `302` and `307` temporary. `307` and `308` keep the method and body; the older two may be turned into a `GET`.
- `304 Not Modified` answers a conditional request: use your cached copy.
- `400` malformed request, `401` not authenticated, `403` authenticated but not allowed, `404` no such resource, `405` wrong method for this resource (requires an `Allow` header), `409` conflict with current state, `413` body too large, `415` unsupported `Content-Type`, `422` well-formed but semantically invalid, `429` rate limited (often with `Retry-After`).
- `500` a bug or unhandled error, `502` and `504` come from a proxy that got a bad or no answer from upstream, `503` temporarily unable to serve.

Where `400` ends and `422` begins is a convention, not a law. Some APIs answer `422` for any body that parses but fails validation; others, including NestJS by default, answer `400` for everything a schema can catch and keep `422` for business rules. Module 4 picks one rule for your own APIs. What matters is that one API is consistent and documents its choice.

## Headers that matter

**Content negotiation.** `Content-Type` describes the body being sent. `Accept`, `Accept-Encoding` and `Accept-Language` say what the client can handle. The server answers with `Content-Type` and `Content-Encoding`. If the response depends on a request header, list that header in `Vary` so caches store one variant per value.

**Caching.** `Cache-Control` is the main switch. `max-age=60` lets a cache reuse the response for 60 seconds without asking. `no-cache` allows storing but requires revalidation before each reuse. `no-store` forbids storing. `private` restricts storage to the user's browser; `public` allows shared caches such as a CDN. Revalidation uses a validator: the server sends `ETag: "v7"`, the client later sends `If-None-Match: "v7"`, and the server replies `304` with no body if nothing changed.

**Cookies.** The server sends `Set-Cookie: sid=abc; HttpOnly; Secure; SameSite=Lax; Path=/`. The browser returns `Cookie: sid=abc` on matching requests. `HttpOnly` hides the cookie from JavaScript, `Secure` restricts it to HTTPS, and `SameSite` controls whether it travels on cross-site requests.

## CORS from the server's side

You have met CORS as a red error in the browser console. On the backend you are the one who answers it. Three facts explain most of it:

- **The browser enforces it, not the server.** By default a page on `https://app.example.com` may send a request to `https://api.example.com`, but its JavaScript may not read the response. CORS headers are how the server tells the browser to relax that rule. `curl`, a mobile app or another server never look at them.
- **Simple requests go straight through.** A `GET`, `HEAD` or `POST` with only basic headers and a form or plain-text content type is sent at once, with an `Origin` header. The server has already run it by the time the browser decides whether the page may see the answer.
- **Everything else is asked about first.** A `PUT`, `PATCH` or `DELETE`, a JSON body (`Content-Type: application/json`) or a custom header such as `Authorization` triggers a **preflight**: the browser sends an `OPTIONS` request and only sends the real one if the reply allows it.

```http
OPTIONS /projects/42 HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: authorization, content-type

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, PATCH, DELETE
Access-Control-Allow-Headers: authorization, content-type
Access-Control-Max-Age: 600
Vary: Origin
```

`Access-Control-Max-Age` lets the browser remember the answer, here for ten minutes, so it does not preflight every call. The real response must carry `Access-Control-Allow-Origin` too.

For cookies or other credentials, the server must also send `Access-Control-Allow-Credentials: true`, and then `Access-Control-Allow-Origin` must name one exact origin. The wildcard `*` is not accepted together with credentials. Servers that allow several origins check the request's `Origin` against a list, echo the one that matches, and send `Vary: Origin` so a cache does not hand one origin's answer to another.

CORS is not authentication and does not protect an API. It only decides which web pages may read your responses in a browser. Anyone can call the API without a browser, so every request still needs its own authentication and authorization (module 6).

## HTTP/1.1, HTTP/2 and HTTP/3

The semantics above are the same in all three. What changes is how bytes travel.

- **HTTP/1.1** is text. A connection carries one request at a time, so browsers open several connections per origin.
- **HTTP/2** uses binary frames and multiplexes many streams over one TCP connection, with compressed headers. A lost TCP packet still stalls every stream on that connection.
- **HTTP/3** runs over QUIC, which is built on UDP with TLS 1.3 included. Streams are independent, so loss on one does not block the others, and connection set-up is faster.

In most deployments a load balancer or reverse proxy terminates HTTP/2 or HTTP/3 and talks HTTP/1.1 to your Node process.

## Reading an exchange with curl

```sh
curl -v https://api.example.com/orders/981
```

Lines starting with `*` are curl's notes about DNS, TCP and TLS. Lines starting with `>` are what curl sent. Lines starting with `<` are what the server returned. Over HTTP/2 and HTTP/3 curl shows header names in lower case and a status line without a reason phrase. Add `-H 'If-None-Match: "v7"'` to try a conditional request.

## Common mistakes

- Returning `200` with `{"error": ...}` in the body. Monitoring, retries and caches all read the status code.
- Changing state in a `GET` handler.
- Mixing up `401` (who are you?) and `403` (I know who you are; no).
- Believing `no-cache` means "do not cache". That is `no-store`.
- Varying a response by a header without listing it in `Vary`, so a shared cache serves the wrong variant.
- Answering the preflight `OPTIONS` with `401` because it carries no token. Browsers never send credentials on a preflight, so it must pass without them.
- Treating a CORS allow-list as security. It limits browsers, not callers.

## Go deeper

- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110): the authoritative definitions of methods, status codes and header fields.
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111): how freshness and validation work, and what each `Cache-Control` directive means.
- [MDN: HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP): readable reference pages for every header and status code.
- [RFC 9114: HTTP/3](https://www.rfc-editor.org/rfc/rfc9114): how the same semantics map onto QUIC streams.
- [curl man page](https://curl.se/docs/manpage.html): every flag, including `-v`, `-i`, `-H` and `--http2`.
- [MDN: Cross-Origin Resource Sharing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS): simple requests, preflights and credentials, with examples.
