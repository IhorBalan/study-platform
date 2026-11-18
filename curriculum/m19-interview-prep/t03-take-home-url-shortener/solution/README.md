# Link shortener (take-home)

## Run

```sh
npm test     # unit tests for the core and HTTP tests against a real server
npm start    # http://127.0.0.1:3000, PORT to override
```

Node 24 or later, no dependencies.

## Assumptions

- The client is identified by `X-Client-Id`, falling back to the socket address. In production this would be the authenticated user, and the IP for anonymous traffic.
- Every create request costs a token, including invalid ones, so probing the validator is rate limited too.
- Aliases are case-sensitive and share one namespace with generated codes.
- Links never change target, so redirects use `302` to keep hit counts accurate (a `301` would be cached by browsers).

## Trade-offs

- **In-memory maps.** Fast to build and test; everything is lost on restart and it cannot run on two instances. Next step: a `links` table with a unique constraint on `code`, inserting and retrying on a unique violation instead of checking `has()` first.
- **Token bucket** rather than a fixed window: no double burst at window edges, and `Retry-After` falls out of the arithmetic. With several instances the buckets move to Valkey with an atomic script.
- **Random 7-character base62 codes** (about 3.5 trillion values) rather than an encoded counter, so codes are not guessable.
- Hit counts are incremented in memory. In Postgres I would batch them rather than update the row on every redirect.

## Not done

- Persistence, auth, a URL blocklist for abuse, metrics, link expiry.

Time spent: about 80 minutes.
