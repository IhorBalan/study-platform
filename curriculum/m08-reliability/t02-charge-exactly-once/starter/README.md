# Charge exactly once

`npm test` builds the project and runs your tests against the database in `DATABASE_URL`
(for the lab: `postgres://lab:lab@localhost:55432/lab`). The tests reset their own tables.

## Notes on my solution

TODO: walk through a crash right after each phase of `pay()`. What does a retry with the same key do in each case?

TODO: what happens to a key whose gateway call failed, and why is that safe?

TODO: why must the gateway's idempotencyKey be derived from the customer and key instead of generated per call?
