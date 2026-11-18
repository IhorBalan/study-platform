The orders API has no metrics. Add the three that every HTTP service should have, using prom-client, and serve them for Prometheus to scrape.

## Requirements

`src/app.ts` exports `createApp()`, which returns an Express 5 app that is not yet listening. Keep its routes as they are. Use only `express`, `prom-client` and Node built-ins.

**`GET /metrics`** returns the registry's output with the registry's content type.

**Metrics**, all registered on a `Registry` created inside `createApp()`, so that two apps in one process do not collide:

| Name | Type | Labels |
| --- | --- | --- |
| `http_requests_total` | counter | `method`, `route`, `status_code` |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status_code` |
| `http_requests_in_flight` | gauge | none |

Plus prom-client's default metrics on the same registry.

- `route` is the matched route's template, for example `/orders/:id`. A request that matches no route uses `"unmatched"`. Never the raw path, never the query string.
- `status_code` is the response status as a string, such as `"404"`.
- `method` is the HTTP method. Map anything outside the usual seven to `"other"`.
- Durations are in seconds, from the request's arrival until the response is done. Use buckets that include `0.1`, `0.25` and `1`; prom-client's defaults do.
- Whether scrapes of `/metrics` are counted is your choice.

## Tests

Write tests in `test/*.test.ts` with `node:test` that send traffic and read `/metrics`. They must pass, and they must fail against an app whose `http_requests_total` never grows, and against one that adds a series per raw path.

## Submission

`src/`, `test/`, `package.json`, `tsconfig.json` and `README.md`, without `node_modules`. In the README, write the PromQL you would put on a dashboard for this service (see the questions there).

## What is checked

The checks run `tsc`, send requests to every route (including ids, query strings and 25 unknown paths), scrape `/metrics`, parse the text format and compare counts, buckets and sums before and after. They hold three slow requests open while reading the gauge, start a second app in the same process, and run your tests against two broken copies.
