# Orders on DynamoDB

An order repository on one DynamoDB table. Read the task brief, then implement `src/orders.ts`.

```sh
pnpm lab up aws                        # from the platform repo, if it is not running
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_RESOURCE_PREFIX=dev-
npm install
npm test                               # creates and deletes its own table
npm run typecheck
```

Node strips the TypeScript types when it runs a `.ts` file, so use only erasable syntax and import local files with their `.ts` extension.

## Notes

TODO: your key design, as a table: each access pattern and the key and operation that serves it.

TODO: which partition would get hot at scale, and how you would spread it.

TODO: why a page can hold fewer than `limit` orders, and why that is acceptable for a cursor API.

TODO: one feature request for this data that would make you move it to Postgres.
