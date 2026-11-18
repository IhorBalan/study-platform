`notes-api` has no CI. Write its GitHub Actions workflow so that every pull request gets a trustworthy answer within minutes, and `main` is checked again after each merge.

## Requirements

Write `.github/workflows/ci.yml`. The scripts it calls already exist in `package.json`.

- **Triggers:** `pull_request` (any branch) and `push` limited to `main`. `workflow_dispatch` is allowed as well. No other triggers.
- **Token:** set `permissions` at the top level to `contents: read` only. No job may grant a write scope.
- **Concurrency:** a group that includes `github.ref`, with `cancel-in-progress: true`.
- **One job named `verify`** on `ubuntu-latest` with `timeout-minutes` of 20 or less.
- **Pinned actions:** every `uses:` points at a full 40-character commit SHA. Put the version in a comment after it (`# v7.0.1`).
- **Toolchain:** Node from `.nvmrc` through `actions/setup-node` (`node-version-file`), pnpm through `pnpm/action-setup` (it reads the version from `packageManager`), and the pnpm store cached (`cache: pnpm` on setup-node is the usual way).
- **Steps, in this order:** `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. No step may hide a failure (`continue-on-error`, `|| true`).
- **Database:** a service container from a `postgres:18` image (a variant such as `postgres:18-alpine` is fine) with `POSTGRES_PASSWORD` set, port `5432:5432` mapped, and a health check that uses `pg_isready`. The test step must see `DATABASE_URL` pointing at it, for example `postgres://app:app@localhost:5432/app_test`, set in the step, job or workflow `env`.

Optional: if you have Docker and `act`, run `act pull_request -j verify` to try it. The install step will fail because this exercise ships no lockfile or source code, but you can watch the service container start and the setup steps run.

## Submission

The project with your `ci.yml`. In `README.md`, replace the TODO with two or three sentences on why the steps are in this order.

## What is checked

The checks read `ci.yml` as YAML and check each requirement above: triggers, permissions, SHA pins, the setup actions and the cache, the order of the five commands, the Postgres service with its port, health check and URL, the concurrency group and the timeout. They do not run the workflow. The review looks at the order of the steps and your reasons, and at whether the versions come from the repository.
