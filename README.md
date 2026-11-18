# Study platform

A local-first platform for learning backend engineering: lessons, hands-on tasks with automated checks and a Claude review, spaced repetition, and progress statistics. It is built with the stack it teaches (React, NestJS, PostgreSQL).

**Status:** early build. The monorepo, the core database tier, the API shell and the web shell work. See [`docs/technical-spec.md`](docs/technical-spec.md) for the plan and [`docs/decisions.md`](docs/decisions.md) for every decision made so far.

## Requirements

- macOS on Apple Silicon (Linux also works)
- Node.js 24 or newer (26 LTS recommended; `.nvmrc` is provided)
- pnpm 11 (`corepack enable` picks the pinned version up)
- A Docker runtime: OrbStack, Colima or Docker Desktop

No cloud accounts are needed.

## Run it

```sh
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` creates `.env` on first run, starts PostgreSQL in Docker, then starts four processes with hot reload: the web app on http://localhost:5173, the API on http://localhost:3000/api, the worker, and the host bridge that runs task checks. Data lives in a Docker volume and survives restarts. `pnpm infra:down` stops the database and keeps the data.

### Working on tasks

```sh
pnpm lab images                                       # once: build the images that run task checks
pnpm lab init ~/code/backend-lab                      # once: create your lab repository
pnpm lab start m00-foundations/t01-raw-http-server    # copy a task's starter files into it
```

Solve the task in the lab repository, commit, and press "Run checks" on the task page. The checks run against the commit inside a container with no internet access. Some modules need practice services, started with `pnpm lab up postgres` (also `valkey`, `aws`, `mailpit`). `pnpm lab status` shows what is running and `pnpm lab down` stops it.

## Commands

| Command                     | What it does                                                         |
| --------------------------- | -------------------------------------------------------------------- |
| `pnpm dev`                  | Start the core tier and all apps in watch mode                       |
| `pnpm build`                | Build every package                                                  |
| `pnpm typecheck`            | Type-check every package                                             |
| `pnpm test`                 | Run tests (the API tests start PostgreSQL with Testcontainers)       |
| `pnpm lint` / `pnpm format` | oxlint / Prettier                                                    |
| `pnpm lab <command>`        | Lab repository, check images and practice services (`pnpm lab help`) |
| `pnpm curriculum:check`     | Validate every file under `curriculum/`                              |
| `pnpm db:generate`          | Generate a SQL migration after editing `packages/db/src/schema.ts`   |

## Layout

```
apps/api        NestJS HTTP API
apps/web        React SPA (Vite, TanStack Router and Query, Tailwind)
packages/shared zod schemas shared by every app
packages/db     Drizzle schema, migrations and client
infra/compose   Docker Compose files
docs            Spec, stack decisions, decision log
```
