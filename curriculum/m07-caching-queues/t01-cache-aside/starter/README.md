# Cache-aside helper

A cache-aside helper for the product page. Read the task brief, then make `src/cache.ts` do what it asks.

```sh
pnpm lab up valkey                     # from the platform repo, if it is not running
export VALKEY_URL=redis://localhost:56379
export VALKEY_KEY_PREFIX=dev:
npm install
npm test                               # node --test runs the .ts files directly
npm run typecheck
```

Node strips the TypeScript types when it runs a `.ts` file, so use only syntax that can be erased (no `enum`, no constructor parameter properties) and import local files with their `.ts` extension.

To look at what the cache writes: `docker exec -it study-lab-valkey-1 valkey-cli --scan --pattern 'dev:*'`.

## Notes

TODO: how your invalidation works, and which race between a slow read and a write it prevents.

TODO: one thing this helper still gets wrong or cannot do, and what you would do about it.
