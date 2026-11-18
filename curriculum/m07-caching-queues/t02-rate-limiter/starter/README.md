# Rate limiter

The API's rate limiter, currently in memory. Read the task brief, then move it to Valkey.

```sh
pnpm lab up valkey                     # from the platform repo, if it is not running
export VALKEY_URL=redis://localhost:56379
export VALKEY_KEY_PREFIX=dev:
npm install
npm test                               # node --test runs the .ts files directly
npm run typecheck
```

Node strips the TypeScript types when it runs a `.ts` file, so use only erasable syntax and import local files with their `.ts` extension.

## Notes

TODO: sliding window log vs fixed window vs token bucket. What does each get wrong, and what does the log cost per client?

TODO: where this limiter belongs in a real deployment, and what the key should be for anonymous and for signed-in clients.

TODO: why fail open is right for this API, and one endpoint where you would fail closed instead.
