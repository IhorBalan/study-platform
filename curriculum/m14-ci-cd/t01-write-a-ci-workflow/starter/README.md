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

TODO: two or three sentences on the order of your steps and why.
