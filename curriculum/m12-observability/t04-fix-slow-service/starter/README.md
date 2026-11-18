# Product service

```sh
npm start                          # http://localhost:3000
curl -s localhost:3000/products/42/related
curl -s 'localhost:3000/products/42?utm_campaign=autumn' | head -c 200
```

Diagnose with the tools from the lesson, for example:

```sh
node --cpu-prof start.mjs          # Ctrl+C writes a CPU-*.cpuprofile file
node --inspect start.mjs           # then open chrome://inspect for heap snapshots
```

## Diagnosis

TODO: the slow related-products pages. Tool, what it showed, cause, fix, before and after numbers.

TODO: the growing memory. Tool, what it showed (snapshot comparison, retainers), cause, fix.

TODO: the metric and alert that would have caught each problem in production.
