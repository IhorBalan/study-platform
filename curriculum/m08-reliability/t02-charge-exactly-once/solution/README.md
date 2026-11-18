# Charge exactly once

`npm test` builds the project and runs your tests against the database in `DATABASE_URL`
(for the lab: `postgres://lab:lab@localhost:55432/lab`). The tests reset their own tables.

## Notes on my solution

`pay()` has three phases. **Claim**: one `insert ... on conflict do nothing` owns a new key; an existing key is replayed (done), refused (different hash, or a live lease) or taken over by one conditional `update` when its lease has expired. **Call**: `gateway.charge` with no transaction open. **Finish**: the payment row and the stored response in one transaction.

Crash after the claim: the key is `started` and nothing was charged. A retry gets `RequestInProgressError` until the lease ends, then takes over and charges. Crash after the call: the card was charged but nothing is recorded. The takeover calls the gateway again with the same key, gets the same charge back, and records it once. Crash after the finish: the retry replays.

A failed gateway call leaves the key `started` with its lease. The outcome is unknown, so the safe move is the same as for a crash: let a retry after the lease repeat the call with the same gateway key. A random key per call would turn every takeover into a second charge.

The unique `charge_id` in `payments` is a second guard: if a slow original and a takeover both reach the finish, the second insert fails instead of recording the charge twice.
