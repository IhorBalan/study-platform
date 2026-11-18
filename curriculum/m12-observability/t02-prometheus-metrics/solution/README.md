# Orders metrics

```sh
npm install
npm start
npm test
npm run typecheck
```

## Dashboard queries

Requests per second by route:

```promql
sum by (route) (rate(http_requests_total[5m]))
```

Share of requests that fail with a 5xx:

```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))
```

p95 latency per route:

```promql
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))
```

## Notes

RED: `http_requests_total` gives the **rate** and, filtered on 5xx, the **errors**. `http_request_duration_seconds` gives the **duration**. The in-flight gauge is a saturation signal on top.

The p95 is an estimate. The histogram only knows how many requests fell between two bucket edges, and `histogram_quantile` assumes they are spread evenly inside that bucket. A true p95 of 260 ms with buckets at 250 ms and 500 ms can be reported anywhere in that range, so put edges close to the latency target you alert on.

Labels: route template, method and status only. A raw path or a user id would create one series per value, and each series costs memory in this process and in Prometheus forever after.
