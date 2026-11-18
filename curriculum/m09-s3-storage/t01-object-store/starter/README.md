# Object store

A storage module over S3. Read the task brief, then make `src/object-store.ts` do what it asks.

```sh
pnpm lab up aws                          # from the platform repo, if the emulator is not running
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_RESOURCE_PREFIX=dev-
npm install
npm test                                 # node --test runs the .ts files directly
npm run typecheck
```

Node strips the TypeScript types when it runs a `.ts` file, so use only syntax that can be erased (no `enum`, no constructor parameter properties) and import local files with their `.ts` extension.

## Notes

TODO: what the app keeps in Postgres for each stored file.

TODO: why the files themselves should not live in a `bytea` column. Give at least one number or limit.
