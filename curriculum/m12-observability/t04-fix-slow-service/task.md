Since the last release, the product service has two complaints against it. Pages that show related products take seconds under load, and every instance is restarted by the platform every few hours for using too much memory. Find both causes with the diagnostic tools from the lesson, fix them, and write down what you found.

## The service

`server.mjs` exports `createServer()`, which returns a `node:http` server that is not yet listening. `start.mjs` starts it on port 3000. The catalogue in `catalogue.mjs` has 100,000 products.

- `GET /products/:id` returns the product with a long description, as JSON.
- `GET /products/:id/related` returns `{ id, related }`: the five best-rated other products in the same category, ties broken by name (`localeCompare`), then by id.
- Anything else, including an unknown id, is a `404`. `GET /health` returns `200`.

Links from newsletters and ads add query strings such as `?utm_campaign=…` to product URLs.

## Requirements

- Keep `createServer()` and every response byte for byte, whatever the query string.
- Serving related products must not block the event loop for long.
- Memory must stay bounded however many different URLs are requested. If you keep a page cache, it holds at most 500 pages.
- Use only Node built-ins. Do not change `catalogue.mjs`.

## Submission

The changed code and a `README.md` with your diagnosis: for each problem, the tool you used, what it showed (paste the relevant numbers or the top frames), the cause, the fix, and the production signal that would have warned you.

## What is checked

The checks start your server in a child process with `--expose-gc` and compare responses with the original. They serve 15 related-products requests while a timer inside your process adds up how long it was late; the total must stay under 600 ms. Then they request 3,000 different pages, each with its own query string, and compare heap use after a full GC with a baseline; growth must stay under 45 MB.
