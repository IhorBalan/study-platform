# Cache-aside helper

```sh
export VALKEY_URL=redis://localhost:56379 VALKEY_KEY_PREFIX=dev:
npm install && npm test && npm run typecheck
```

## Notes

**Invalidation.** Each key has a version marker next to it (`<key>:version`). `invalidate` writes a new random version and deletes the value in one Lua script. A load reads the version before it calls the loader, and stores its result with a script that checks the version is unchanged. Without this, the race goes: a read misses and starts loading the old price, an admin updates the price and invalidates, the read finishes and stores the old price, and the page shows it until the TTL ends.

**Stampedes.** Inside a process, callers for the same key share one promise. Across processes, the first caller takes a lock (`SET <key>:lock <token> PX lockTimeoutMs NX`); the others poll the value every 25 ms. The lock expires by itself, and a waiter that passes the deadline loads anyway, so a crashed process cannot block a key for long. The lock is released only by its owner (compare the token, then delete, in Lua).

**What it still gets wrong.** A call that arrives while a load is in flight joins that load, even when `invalidate` ran in between, so that one caller can get the old value once. Fixing it means tracking the version per in-flight promise. Also, the database write and `invalidate` are two separate steps: if the process dies between them, the cache keeps the old value until the TTL. For data where that matters, invalidate from the outbox or a change feed, and keep TTLs short.
