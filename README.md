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
cp .env.example .env
pnpm dev
```

`pnpm dev` starts PostgreSQL in Docker, then the API on http://localhost:3000/api and the web app on http://localhost:5173, both with hot reload. Data lives in a Docker volume and survives restarts. `pnpm infra:down` stops the database and keeps the data.

## Commands

| Command                     | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                  | Start the core tier and all apps in watch mode                     |
| `pnpm build`                | Build every package                                                |
| `pnpm typecheck`            | Type-check every package                                           |
| `pnpm test`                 | Run tests (the API tests start PostgreSQL with Testcontainers)     |
| `pnpm lint` / `pnpm format` | oxlint / Prettier                                                  |
| `pnpm db:generate`          | Generate a SQL migration after editing `packages/db/src/schema.ts` |

## Layout

```
apps/api        NestJS HTTP API
apps/web        React SPA (Vite, TanStack Router and Query, Tailwind)
packages/shared zod schemas shared by every app
packages/db     Drizzle schema, migrations and client
infra/compose   Docker Compose files
docs            Spec, stack decisions, decision log
```
