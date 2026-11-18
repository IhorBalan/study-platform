# notes-api CI

A small TypeScript API. Its integration tests read `DATABASE_URL` and need a PostgreSQL 18 database.

The only file to write is `.github/workflows/ci.yml`. The scripts it calls are in `package.json`:

| Script | What it does |
| --- | --- |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest, unit and integration tests |
| `pnpm build` | Compiles to `dist/` |

To try the workflow on your machine (optional, needs Docker and `act`):

```sh
act pull_request -j verify
```

## Notes

The steps run from cheapest to most expensive: lint and typecheck fail in seconds, so a typo never waits for the database tests. The build runs last because tests do not need `dist/`, and a broken build after green tests is rare. One job keeps it to a single `pnpm install`; with a slower suite I would split lint and typecheck into a parallel job.
