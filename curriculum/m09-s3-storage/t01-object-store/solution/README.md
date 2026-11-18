# Object store

A storage module over S3. See the task brief for the interface.

```sh
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_RESOURCE_PREFIX=dev-
npm test
npm run typecheck
```

`getStream` hands back the live HTTP response. Whoever calls it must read it to the end or call `body.destroy()`: until then the socket stays checked out of the SDK's connection pool, and after about 50 forgotten streams every S3 call waits for a free socket.

## Notes

**What Postgres keeps per file.** A `files` row: `id`, `owner_id`, the S3 `key`, `content_type`, `size_bytes`, a `sha256` or the ETag, `status` (`pending`, `ready`, `rejected`), `original_name` for display only, and `created_at`. Queries ("all invoices of customer 42", "total storage per tenant") run against this table. S3 holds only the bytes, under a key the app generated.

**Why not a `bytea` column.** A 20 MB upload in a row means 20 MB through the connection pool, into WAL, into every replica and every `pg_dump`, so backups grow with user files instead of business data. A `bytea` value is capped at 1 GB, and reading one makes Postgres and the Node process each hold the whole value in memory, where S3 streams it in chunks. Storage is also priced differently: a managed Postgres disk costs several times more per GB-month than S3 Standard, and S3 adds cheaper tiers and lifecycle rules.
