# Rate limiter

```sh
export VALKEY_URL=redis://localhost:56379 VALKEY_KEY_PREFIX=dev:
npm install && npm test && npm run typecheck
```

## Notes

**Algorithm.** A fixed window counts per calendar slot, so a client can send the full limit at 11:59:59 and again at 12:00:00: twice the limit in one second. The sliding window log stores one sorted-set member per allowed request and counts only those in the last `windowMs`, so it is exact. The cost is memory: up to `limit` members per active client, which matters for limits like 10,000 per hour. A token bucket stores two numbers per client (tokens and last refill), allows short bursts up to the bucket size, and refills at a steady rate; it is the usual choice for high limits. A sliding window counter (two fixed windows, weighted) is a cheap approximation of the log.

**Atomicity.** The script removes old entries, counts, adds and sets the TTL in one step inside Valkey. Done as separate commands, two instances can both read "9 of 10" and both add, and 60 concurrent requests get through instead of 10.

**Where.** Coarse per-IP limits belong at the edge (CDN, gateway or reverse proxy), before the app spends anything on the request. Per-user and per-plan limits belong in the app, where the user is known: key by user id or API key when signed in, by IP (or IP plus route) when anonymous. Expensive routes get their own, lower limits.

**Failure mode.** This limiter protects capacity, so if Valkey is down it is better to serve everyone than no one. For login, password reset or sending SMS, the limit is a security control against brute force and cost abuse, and I would fail closed there (503) instead.
