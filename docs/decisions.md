# Decision log

Every decision made without asking first is recorded here so it can be reviewed and reversed. Newest entries go at the bottom. Each entry says what was chosen, why, what else was on the table, and what would make it worth revisiting.

Status values: **Accepted** (in use), **Provisional** (chosen, but depends on something not yet verified), **Superseded** (replaced; the entry says by what).

Decisions agreed with Ihor before this log existed are in [`HANDOFF.md`](./HANDOFF.md), section 2. Versions and sources are in [`stack-decisions.md`](./stack-decisions.md).

---

## Process

### D-001 · Work on branch `claude/project-thread-udr6y6` — Accepted, 2026-11-18
- **Chosen:** branch from `claude/admiring-dirac-jffo8u` and commit there.
- **Why:** this session can only push to that branch. Ihor confirmed.
- **Alternatives:** continue on the handoff branch (not permitted).
- **Revisit if:** you want a different branch or a `main` branch as the default. The repo currently has no `main`.

### D-002 · Build without an approval gate, log decisions here — Accepted, 2026-11-18
- **Chosen:** go from research straight into the build, recording each decision in this file.
- **Why:** Ihor asked for proactive work with a reviewable log. This replaces the "stop after Phase 1" rule in the original brief.
- **Revisit if:** a decision here turns out to be expensive to undo. Those are marked "hard to reverse" below.

### D-003 · Verify versions against the npm registry, not only articles — Accepted, 2026-11-18
- **Why:** several articles disagreed with each other or with the registry (Drizzle "1.0 stable", Vitest "4.x latest", Prisma 6 vs 7).
- **Consequence:** where an article and the registry differ, the registry wins.

---

## Runtime and tooling

### D-010 · Node 26 LTS, minimum Node 24 — Accepted
- **Why:** 26 is the active LTS until October 2027. `ts-fsrs` 6 declares `node >= 24`.
- **Alternatives:** Node 22 (still supported, but excluded by ts-fsrs 6); pin ts-fsrs 5.x to keep Node 22 (older algorithm version, no gain).
- **Revisit if:** a dependency needs an older runtime.

### D-011 · TypeScript 7.0 — Provisional
- **Why:** it is the GA compiler and much faster. I compiled a legacy-decorator sample with 7.0.2 and it emitted `design:paramtypes`, so NestJS dependency injection works.
- **Alternatives:** TypeScript 6.0 (fully compatible with every tool, slower, and the line being left behind).
- **Cost:** no type-aware linting until TS 7.1 ships its API.
- **Revisit if:** any build tool in the repo fails on 7.0. Falling back to `typescript@^6` is a one-line change.

### D-012 · pnpm 11, not 12 — Accepted
- **Why:** I could read pnpm 11's release notes but found nothing on 12, which npm already tags `latest`.
- **Alternatives:** pnpm 12; npm workspaces; bun (not the tool most backend jobs use).
- **Revisit if:** pnpm 12 turns out to be routine. The change is one `packageManager` field.

### D-013 · pnpm workspaces + Turborepo — Accepted
- **Alternatives:** Nx (more features than three apps need); plain workspaces (no caching or task graph).

### D-014 · oxlint + Prettier — Accepted
- **Why:** NestJS 12 generates oxlint projects, and it does not need the TypeScript API that 7.0 lacks.
- **Alternatives:** ESLint + typescript-eslint (would force TypeScript 6); Biome (single tool, but not what Nest or most job repos use).

---

## Backend

### D-020 · NestJS 12 as an ESM project on Express 5 — Accepted, hard to reverse
- **Why:** current major, ESM core, Vitest by default. Express is the Nest default and the most used Node framework.
- **Alternatives:** Fastify adapter (faster, fewer tutorials; covered in a lesson); NestJS 11 (older, CommonJS, Jest).
- **Revisit if:** the ESM setup causes tooling trouble. Switching the adapter later is cheap; switching ESM to CommonJS is not.

### D-021 · zod schemas in `packages/shared`, validated through Nest's Standard Schema support — Accepted
- **Why:** one definition for request bodies, queue payloads, the Claude review JSON and the web forms.
- **Alternatives:** class-validator DTOs (Nest's documented default, taught in module 1 but not used for platform code); nestjs-zod (unnecessary now that Nest supports Standard Schema itself).

### D-022 · Drizzle 0.45 on PostgreSQL 18 — Accepted
- **Why:** the query builder reads like SQL, which suits a learner who should see the queries. PostgreSQL 19 is not GA until 2026-11-19.
- **Alternatives:** Prisma (most downloads, but hides SQL, and its npm `latest` tag currently points at an 8.0 release candidate); Kysely (no migration tooling of its own); TypeORM / MikroORM (decorator entities, common in older Nest code, covered as reading).
- **Constraint adopted:** use the SQL-like builder, not `db.query` relational queries, because Drizzle 1.0 changes that API.
- **Revisit if:** Drizzle 1.0 goes GA (upgrade), or you would rather practise Prisma for job reasons.

### D-023 · pg-boss for platform jobs — Accepted
- **Why:** the core tier stays at one Postgres and about 1 GB RAM, as agreed.
- **Alternatives:** BullMQ + Valkey (the industry default, and it is what the queues module teaches in the lab); graphile-worker.
- **Revisit if:** job throughput matters (it will not, for one user).

### D-024 · Platform uploads on local disk — Accepted
- **Why:** the platform must not depend on the lab's AWS emulator, and MinIO community images no longer exist.
- **How:** a `StorageService` interface with a local-disk implementation under `data/uploads`, so an S3 implementation can be added as an exercise.
- **Alternatives:** a second emulator instance for the platform (more RAM, no benefit); storing files in Postgres `bytea` (bad practice to model).

---

## Frontend

### D-030 · React 19 + Vite 8 + TanStack Router + TanStack Query — Accepted
- **Alternatives:** React Router 8 (more common at work, weaker typing); Next.js (server rendering is pointless for a local tool).

### D-031 · Tailwind 4 + shadcn/ui, Recharts, Markdown rendered with Shiki — Accepted
- **Why Markdown and not MDX:** lessons are data in `curriculum/`, loaded by the API. MDX would compile lesson content into the web bundle.

---

## Lab, emulation and sandbox

### D-040 · Floci as the lab AWS emulator, pinned to a dated release — Provisional
- **Why:** MIT licence, no account or token, about 13 MiB idle, covers S3, SQS, SNS, Lambda, IAM, DynamoDB, Secrets Manager, SSM, CloudWatch Logs and EventBridge.
- **Alternatives:** LocalStack current (needs an account and token, which the brief rules out); LocalStack pinned to an old tag (works, but no security patches); LocalEmu (LocalStack fork, one maintainer, 1.0.0 in June 2026); Moto server (no real Lambda runtime); single-service emulators (ElasticMQ, DynamoDB Local; more containers, no IAM or EventBridge).
- **Risks:** the project is under a year old, its numbers are self-reported, and IAM enforcement is off by default.
- **Mitigation:** tasks reach AWS through one endpoint variable (`AWS_ENDPOINT_URL`), so the emulator can be swapped without touching task code.
- **Revisit if:** a lesson needs behaviour Floci gets wrong. The first thing to try is the pinned LocalStack image.

### D-041 · Lambda tasks run in a separate opt-in lab profile — Provisional
- **Why:** Floci runs Lambda functions in real containers and needs the Docker socket. Giving the default lab emulator the socket would break the rule that only the host bridge controls Docker.
- **Chosen:** the default lab emulator has no socket. `pnpm lab up lambda` starts a second emulator with the socket mounted, with a warning in the lesson about what that grants.
- **Alternatives:** teach Lambda as theory only; route Lambda container creation through the bridge (much more work).
- **Revisit if:** Floci gains a socket-free Lambda mode.

### D-042 · Host bridge drives Docker through the `docker` CLI — Accepted
- **Why:** the hardening flags stay readable and can be copied into a terminal to reproduce a run.
- **Alternatives:** dockerode (programmatic, hides the flags, another dependency).

### D-043 · Valkey 8.1 for lab cache and queues — Accepted
- **Alternatives:** Redis 8 (tri-licensed SSPL / RSAL / AGPL); Valkey 9 (newer, slightly slower in BullMQ's benchmark).

### D-044 · OpenTofu for the IaC module — Accepted
- **Why:** open licence, no account, same HCL as Terraform.
- **Alternatives:** Terraform (BSL licence; lessons note where commands differ); CDK (needs a `cdklocal`-style wrapper, more moving parts); Pulumi.

---

## Verification

### D-050 · "Copy for Claude" is the default review mode; one-click is opt-in — Accepted
- **Why:** one-click relies on `claude -p` drawing from the Pro plan. That works today, but Anthropic announced a separate metered credit for it in May 2026 and paused the change in June. Copy-paste cannot be affected.
- **Consequence:** every task type must be reviewable through copy-paste.

### D-051 · One-click invocation shape — Provisional
- **Chosen:** `claude -p --output-format json --json-schema <schema> --tools "Read,Grep,Glob" --permission-mode dontAsk --max-turns <n> --no-session-persistence`, run by the bridge with the task folder as the working directory.
- **Why not `--bare`:** bare mode does not read the subscription login, so it would require an API key.
- **Risk:** the docs say `--bare` will become the default for `-p`. If that lands, the bridge will need an explicit opt-out or an API key.
- **Unverified:** behaviour of the macOS Keychain login when `claude` is spawned by a Node child process. I cannot test macOS from here; this needs a check on your machine.

### D-052 · Anthropic API provider is an interface only — Accepted
- Agreed in the handoff. Recorded for completeness. Estimated cost if built: about $0.06 per review on Sonnet 5.5.

---

## Learning features

### D-060 · `ts-fsrs` 6 with default parameters — Accepted
- **Why:** FSRS clearly beats SM-2, and the library can rebuild schedules from stored review logs.
- **Alternatives:** SM-2 (simpler, worse retention prediction); writing FSRS by hand (pointless).
- **Later option:** fit personal parameters with `@open-spaced-repetition/binding` once there are a few hundred reviews.

### D-061 · Relative effort (S / M / L) instead of week estimates — Accepted
- Follows the "fully self-paced" decision in the handoff.

### D-062 · Curriculum additions from the industry check — Accepted
- **Added:** Docker as its own module; a Kafka and log-based messaging lesson (optional); GraphQL and gRPC as one comparison lesson.
- **Changed:** Kubernetes stays optional but is marked "recommended for a job switch", because about a third of backend postings name it.
- **Superseded in part by D-064** for Kubernetes and Kafka.

### D-064 · Kubernetes and Kafka are core, taught as theory — Accepted, 2026-11-18 (Ihor's call)
- **Chosen:** both modules are in the core path. They cover what each tool is, how it works, and when and where to use it in practice. Tasks are written design questions reviewed by Claude. There is no Docker practice environment; each module ends with a "practise on your own" section.
- **Why:** Ihor asked for both in the learning path and said hands-on practice can be left to the learner.
- **Replaces:** the "optional" status in D-062, and the `kind` elective in the stack table.

### D-063 · Order of the build — Accepted
1. Monorepo, Compose core tier, database schema, API and web shell.
2. Curriculum loader and lesson reader, with modules 0–2 authored.
3. Spaced repetition end to end.
4. Lab CLI, host bridge, sandbox, stage 1 checks.
5. Claude review (copy-paste, then one-click).
6. Plan and statistics.
7. Remaining modules, written in batches.
8. Full mode, CI pipeline, README.
- **Why this order:** each step leaves something usable, and reading plus flashcards (the low-RAM path) works after step 3.

---

## Build log

Decisions made while building are appended below.

### D-070 · API dev loop is `tsc --watch` plus `node --watch` — Accepted, 2026-11-18
- **Why:** TypeScript 7 compiles the API in well under a second, and it emits decorator metadata itself. That removes the need for SWC, Rspack or `nest start` in the dev path, so there is one less tool to understand.
- **Alternatives:** `nest start --watch` (adds the Nest CLI and its builder choice); SWC builder (faster than old `tsc`, no advantage over TS 7).
- **Note:** tests still use SWC through `unplugin-swc`, because Vitest's transformer does not emit decorator metadata. Verified: the e2e test injects providers correctly with it.

### D-071 · Migrations run when the API starts — Accepted, 2026-11-18
- **Why:** one user and one instance, so there is no race, and `pnpm dev` works on an empty volume.
- **Alternatives:** a separate `pnpm db:migrate` step (kept as a script, and the pattern a team would use in production; module 3 explains the difference).

### D-072 · Workspace packages are consumed as built output (`dist`) — Accepted, 2026-11-18
- **Why:** plain Node ESM resolution with no path aliases, which TypeScript 7 no longer supports through `baseUrl` anyway. Turborepo builds dependencies first.
- **Alternatives:** TypeScript project references; importing `.ts` sources directly with a bundler.

### D-073 · Vite proxies `/api` to the API in dev — Accepted, 2026-11-18
- **Why:** the browser sees one origin, so no CORS configuration is needed for normal use. The API still sets CORS for the web origin, for the case where the proxy is bypassed.

### D-074 · API and web bind to 127.0.0.1 only — Accepted, 2026-11-18
- **Why:** the platform has no authentication (single user, local), so it must not be reachable from the network.

### D-075 · UI components are hand-written with Tailwind for now — Provisional, 2026-11-18
- **Why:** the shell needs four small components. shadcn/ui components get added when a screen needs a dialog, tabs or a form.
- **Revisit if:** the UI grows faster than expected.

### D-076 · Build scripts are allow-listed in `pnpm-workspace.yaml` — Accepted, 2026-11-18
- **Why:** pnpm 11 blocks dependency install scripts unless listed. `@swc/core` and `esbuild` are allowed; the optional native speed-ups that Testcontainers pulls in (`ssh2`, `cpu-features`, `protobufjs`) are explicitly declined.
