Below is the output of `curl -v` for one request to a product API. Explain it, in your own words, as if to a colleague who has only ever used `fetch`.

```sh
$ curl -v --compressed -H 'Accept: application/json' https://shop.example.com/api/products/42
* Connected to shop.example.com (203.0.113.10) port 443
* ALPN: server accepted h2
* SSL connection using TLSv1.3
* using HTTP/2
* [HTTP/2] [1] OPENED stream for https://shop.example.com/api/products/42
> GET /api/products/42 HTTP/2
> host: shop.example.com
> user-agent: curl/8.x
> accept: application/json
> accept-encoding: gzip, br
>
< HTTP/2 200
< content-type: application/json; charset=utf-8
< content-encoding: gzip
< content-length: 89
< cache-control: private, max-age=60
< etag: "p42-v7"
< vary: Accept-Encoding
< date: Wed, 18 Nov 2026 10:15:00 GMT
<
{"id":42,"name":"Desk lamp","price":3900,"currency":"EUR","stock":12}
```

## What to write

Answer in prose, 300–600 words, under these four headings.

1. **The exchange.** What do the `*`, `>` and `<` lines show? Walk through the request: method, target and each header that changes what the server sends. Is this request safe? Is it idempotent?
2. **The protocol.** Which HTTP version is in use, and how can you tell from the transcript? Name two things that would look different over HTTP/1.1.
3. **The response.** What does the status code say, and what do `content-type`, `content-encoding`, `content-length` and `vary` each tell the client or a cache?
4. **Caching.** With the headers as shown: who may store this response, and for how long can it be reused without asking the server? The same client asks again after 90 seconds. Write the request header it adds, and describe both possible responses. Then say what would change, and when you would choose it, if `cache-control` were instead:
   - `public, max-age=3600`
   - `no-cache`
   - `no-store`

## What is assessed

Each rubric item looks for specific statements about this transcript: the meaning of the prefixes, the properties of the method, the evidence for the protocol version, the role of each response header, the freshness lifetime and who may cache, the exact conditional header and both outcomes, and the effect of each alternative directive. General definitions that do not refer to the transcript earn little.
