# Quote API tracing

The quote API and the start of its tracing set-up. Read the task brief, then instrument it.

```sh
npm install
npm test                     # node --test runs the .ts files directly
npm run typecheck
PRICING_URL=http://localhost:3001 npm start   # spans are printed to the console
```

`npm start` needs something answering `GET /prices/:sku` with `{ "price": 2.5 }`. A ten-line `node:http` server will do.

Node strips the TypeScript types when it runs a `.ts` file, so use only erasable syntax and import local files with their `.ts` extension.

## Notes

TODO: what you would change for production: the span processor, the exporter and where it sends spans, the sampler and its ratio.

TODO: how a log line written during a request would carry the trace id, and why you want that.
