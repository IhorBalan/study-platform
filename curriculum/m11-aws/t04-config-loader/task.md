The orders API reads its settings from environment variables typed into the deployment by hand, including the database password. Move them to SSM Parameter Store and Secrets Manager, load them once at start-up, and refuse to start with anything invalid.

## Requirements

Implement `src/config.ts`. Keep its exported types, `ConfigError` and the signatures. Import only `@aws-sdk/client-ssm`, `@aws-sdk/client-secrets-manager`, `zod` and Node built-ins, and call AWS only through the clients you are given.

**`loadConfig({ ssm, secrets, parameterPath, secretId })`** reads every parameter under `parameterPath` (for example `/prod/orders-api/`) and the secret `secretId`, and returns an `AppConfig`:

| Parameter (relative name) | Type | Becomes | Rule |
| --- | --- | --- | --- |
| `port` | String | `port` | required, integer 1 to 65535 |
| `log-level` | String | `logLevel` | `debug`, `info`, `warn` or `error`; default `info` |
| `allowed-origins` | StringList | `allowedOrigins` | required, at least one, each a URL |
| `feature/<name>` | String | `features[<name>]` | `true` or `false`; any number of them |
| `stripe/webhook-secret` | SecureString | `stripe.webhookSecret` | required, starts with `whsec_` |
| `db/pool-max` | String | `database.poolMax` | integer 1 to 100; default 10 |

Other parameters are ignored. The secret is JSON `{ username, password, host, port, dbname }`; `database.url` is `postgres://<username>:<password>@<host>:<port>/<dbname>` with user name and password passed through `encodeURIComponent`.

Read the tree with `GetParametersByPath` (all pages) and the secret with one `GetSecretValue`. If anything is missing or invalid, including a missing or malformed secret, throw one `ConfigError` whose `issues` name every problem: the relative parameter name, or the secret id. No message, issue or stack may contain a value.

**`createCredentialsCache({ secrets, secretId, ttlMs, now? })`** returns `{ get, refresh }` for the same secret, parsed to `DbCredentials`. `get()` reuses a value younger than `ttlMs` (measured with `now`, default `Date.now`); concurrent calls share one fetch. `refresh()` always fetches.

## Tests

Write tests in `test/*.test.ts` with `node:test` against the emulator. The emulator returns every parameter in one page unless `MaxResults` is set, while AWS returns at most 10; the starter test gives `loadConfig` a client that sets `MaxResults: 10` when it is missing, and the checks do the same. Put your parameters under `/` + `AWS_RESOURCE_PREFIX` + something unique, start secret names with `AWS_RESOURCE_PREFIX`, and delete everything in `after()`. Your tests must pass, and fail against a loader that reads only the first page and one that does not decrypt.

## Submission

`src/`, `test/`, `package.json`, `tsconfig.json` and `README.md`, without `node_modules`. Answer the four notes in `README.md`.

## What is checked

The checks run `tsc`, write trees and secrets of their own, and call your loader through recording clients: a complete tree, defaults, 17 parameters, a SecureString, a password full of URL characters, a tree with seven problems, secret values that must not leak, a missing secret, the calls made, and the cache with a controlled clock and two rotations. Then they run your tests against your code and two broken copies.
