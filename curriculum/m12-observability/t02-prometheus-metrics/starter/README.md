# Orders metrics

The orders API. Read the task brief, then give it metrics.

```sh
npm install
npm start                    # http://localhost:3000
npm test                     # node --test runs the .ts files directly
npm run typecheck
curl -s localhost:3000/orders/7 && curl -s localhost:3000/metrics | grep http_
```

Node strips the TypeScript types when it runs a `.ts` file, so use only erasable syntax and import local files with their `.ts` extension.

## Notes

TODO: PromQL for requests per second by route, the share of requests that fail with 5xx, and the p95 latency per route.

TODO: which RED signal each of the three HTTP metrics gives you, and why a p95 computed from a histogram is an estimate.
