---
title: Distributed locks and their limits
skills: [distributed-locks]
---

Sooner or later two instances of your service will both try to do something that should happen once: run the nightly import, refresh the same expensive cache entry, charge a card for the same order. The reflex is "take a lock in Redis". Locks in Valkey are useful and easy to write, but they promise less than the word suggests. This lesson shows how to write one correctly and, more importantly, why a lock with a timeout cannot on its own guarantee that two processes never act at the same time.

## A lock in Valkey

A lock is a key that only one client can create, with a value that only its owner knows, and a TTL so that a crashed owner cannot hold it forever.

```ts
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.VALKEY_URL ?? 'redis://localhost:56379');
const prefix = process.env.VALKEY_KEY_PREFIX ?? 'dev:';

// Grant the lock and hand out the next fencing token in one atomic step.
const ACQUIRE = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
  return redis.call('INCR', KEYS[2])
end
return false
`;

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const EXTEND = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

export async function withLock<T>(
  name: string,
  ttlMs: number,
  work: (fence: number, lost: AbortSignal) => Promise<T>,
): Promise<T | null> {
  const key = `${prefix}lock:${name}`;
  const token = randomUUID();
  const fence = (await redis.eval(ACQUIRE, 2, key, `${prefix}fence:${name}`, token, ttlMs)) as number | null;
  if (fence === null) return null; // someone else holds it
  const lost = new AbortController();
  const renew = setInterval(() => {
    redis.eval(EXTEND, 1, key, token, ttlMs).then(
      (ok) => { if (ok === 0) lost.abort(); }, // the lock is gone: tell the work to stop
      (err) => console.warn('lock renewal failed', err), // a blip: the next tick tries again
    );
  }, ttlMs / 3);
  try {
    return await work(fence, lost.signal);
  } finally {
    clearInterval(renew);
    await redis.eval(RELEASE, 1, key, token);
  }
}
```

Four details carry the weight:

- **`SET ... NX PX` in one command.** `SETNX` followed by `EXPIRE` leaves a moment in which a crash creates a lock that never expires.
- **The grant and the fencing token in one script.** With a separate `INCR`, one process can take the lock and pause before its `INCR`. The lock expires, a second process takes it and gets 42, then the first wakes up and gets 43. The stale holder would then carry the higher number.
- **A random token, checked on release.** Suppose your lock expired while you were slow and another process took it. A plain `DEL` would now delete *their* lock. Compare-and-delete must be atomic, hence the Lua script.
- **Renewal while working.** The TTL must be short, so a crashed holder frees the lock soon, but the work may take longer than the TTL. A timer extends the lock while the work runs, again only if the token still matches. A renewal that returns `0` means the lock is gone, so it aborts `lost` and the work can stop. A failed renewal is caught and logged: a bare `void redis.eval(...)` would turn one Valkey blip into an unhandled rejection, which ends the Node process.

The `fence` number is explained below.

## Why the lock can still fail you

Everything above is correct, and two processes can still both believe they hold the lock. The TTL is the cause. Consider:

1. Process A takes the lock with a 30-second TTL and starts the import.
2. A stops for 40 seconds: a long garbage-collection pause, a blocked event loop, a VM migration, a network partition that delays its renewals.
3. The lock expires. Process B takes it and starts the import.
4. A wakes up. Nothing tells it that its lock is gone; it carries on writing.

Now two imports run at once. Renewal makes this rarer, not impossible: A's renewal is exactly what did not run while it was paused. The check "do I still hold the lock?" does not help either, because A can pause just after the check. No client-side trick fixes this, because the problem is that **time passes between checking the lock and acting on the resource**, and the resource does not know about the lock.

Using several Valkey nodes (the Redlock algorithm) protects against one node failing, not against this. Martin Kleppmann's essay on distributed locking walks through the argument; the short version is that a lock with a lease is fine when an occasional overlap is harmless and wrong when it is not.

## Efficiency or correctness?

Ask what happens if two holders overlap once:

- **Efficiency locks** prevent wasted work: two instances refreshing the same cache entry, two sending the same digest email that is also deduplicated elsewhere. An overlap costs a little extra work. A Valkey lock is a good fit.
- **Correctness locks** prevent damage: applying a price change twice, charging twice, overselling the last seat. An overlap corrupts data. A Valkey lock alone is not enough.

## Fencing tokens

The fix for correctness is to make the resource itself reject the stale holder. Each time the lock is granted, hand out a number that only goes up (the `INCR` above). The holder sends it with every write, and the resource remembers the highest number it has seen and refuses anything lower:

```sql
UPDATE products
SET price_cents = $2, fence = $3
WHERE id = $1 AND fence < $3;
```

In the story above, A got fence 41 and B got fence 42. B's writes set `fence = 42`, and A's late writes with 41 match no rows. The overlap still happens, but it can no longer do damage. The price is that every protected resource must check the token, which works for your own database and rarely for a third-party API.

## Often you do not need a lock at all

Before writing a lock, check whether the database already gives you what you want:

- **A unique constraint** or `INSERT ... ON CONFLICT DO NOTHING` makes "create once" safe without any lock.
- **`SELECT ... FOR UPDATE`** or a conditional `UPDATE ... WHERE status = 'pending'` serialises changes to a row inside a transaction (module 8 covers both).
- **PostgreSQL advisory locks** (`pg_advisory_xact_lock(42)`) are held by your transaction and released when it commits or rolls back. If the process dies, the connection drops and the lock goes with it. No TTL, so no expiry while you work, and the lock lives in the same system as the data it protects.
- **A queue with one consumer** (or a BullMQ job with a fixed `jobId`) turns "only one at a time" into "one after another".
- **Idempotent work** makes an overlap harmless: two imports that both set the price to 12 do no damage; two that both add 2 do.

## Common mistakes

- `SETNX` and `EXPIRE` as two commands.
- Releasing with a plain `DEL`, which can delete someone else's lock.
- A TTL shorter than the work, without renewal: the lock expires midway as a matter of routine.
- No TTL at all, so one crash blocks the job until someone deletes the key by hand.
- Relying on a lease-based lock for correctness without fencing tokens, idempotency or a database constraint.

## Go deeper

- [Martin Kleppmann: How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html): the pause problem and fencing tokens.
- [Valkey: distributed locks](https://valkey.io/topics/distlock/): the single-instance pattern and Redlock.
- [Valkey: SET](https://valkey.io/commands/set/): `NX`, `PX` and the conditional options.
- [PostgreSQL: explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html): row locks and advisory locks.
