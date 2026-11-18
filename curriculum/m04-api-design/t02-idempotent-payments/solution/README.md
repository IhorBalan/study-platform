# Payments API: idempotency keys

```sh
npm install
npm run build && npm start     # http://127.0.0.1:3000
```

## Notes

Records live in an in-memory map keyed by the Idempotency-Key, holding a SHA-256 fingerprint of the validated body and, once done, the response. A key is reserved before the charge and released if the charge fails, so concurrent duplicates get 409 and a failed request can be retried with the same key.

In production I would keep records for 24 hours, long enough to cover any sensible client retry window, and scope keys per API client so two customers cannot collide.

With more than one instance the map no longer works: two instances could both reserve the same key. The reservation must be atomic in shared storage, for example an `INSERT ... ON CONFLICT DO NOTHING` on a table with the key as primary key, or `SET key value NX EX 86400` in Valkey.
