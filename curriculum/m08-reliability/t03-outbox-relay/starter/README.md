# Outbox, relay and inbox

`npm test` builds the project and runs your tests against the database in `DATABASE_URL`
(for the lab: `postgres://lab:lab@localhost:55432/lab`). The tests reset their own tables.

## Notes on my solution

TODO: how does your relay stop two relays from publishing the same message, and what does it hold (locks, connections) while it publishes?

TODO: why is delivery at least once and not exactly once? Name the moment a crash causes a duplicate, and how the inbox deals with it.

TODO: what happens to a message whose publish keeps failing? What would you add before production?
