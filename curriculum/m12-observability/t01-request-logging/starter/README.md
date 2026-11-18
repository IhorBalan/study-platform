# Request logging

The orders API. Read the task brief, then make its logs useful and safe.

```sh
npm install
npm start                    # http://localhost:3000
npm test                     # node --test runs the .ts files directly
npm run typecheck
curl -s localhost:3000/orders/7 -H 'x-request-id: try-1'
```

Node strips the TypeScript types when it runs a `.ts` file, so use only erasable syntax and import local files with their `.ts` extension. Pipe the output through `npx pino-pretty` if you want to read it comfortably while developing.

## Notes

TODO: what an unchecked `x-request-id` could do to your logs.

TODO: three kinds of data this service must never log.

TODO: one field you would add to every line next, and why.
