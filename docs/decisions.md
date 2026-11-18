# Decision log

Every decision made without asking first is recorded here so it can be reviewed and reversed. Newest entries go at the bottom. Each entry says what was chosen, why, what else was on the table, and what would make it worth revisiting.

Status values: **Accepted** (in use), **Provisional** (chosen, but depends on something not yet verified), **Superseded** (replaced; the entry says by what).

Decisions agreed with Ihor before this log existed are at the end of this file, under "Agreed before this log". Versions and sources are in [`stack-decisions.md`](./stack-decisions.md).

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

### D-077 · A lesson's cards join the review queue when the lesson is marked done — Accepted, 2026-11-18
- **Why:** loading every deck at start-up would fill the queue with hundreds of cards about material not yet read.
- **Alternatives:** import all decks up front and rely on the new-cards-per-day limit (cards would arrive in file order, ahead of the reading); add cards when a lesson is opened (too early).
- **Detail:** cards are keyed by `<lesson>#<card id>`, so completing a lesson twice never duplicates cards or resets their schedule.

### D-078 · FSRS-7 through `ts-fsrs` 6, with the library's default scheduler — Accepted, 2026-11-18
- **Why:** `ts-fsrs` 6 defaults to FSRS-7, and the benchmark author describes it as the final version of the algorithm. The handoff asked for "standard FSRS", and this is the current standard.
- **Alternatives:** pin `version: 'FSRS-6'` (the version the published benchmark numbers are for).
- **Safeguard:** each review row stores the model name, the desired retention and the library's raw review log, so schedules can be recomputed under another version.
- **Observed behaviour worth knowing:** with the defaults, grading a new card "Good" sends it straight to review in about 4.8 days, with no same-day learning step.
- **Revisit if:** you prefer short same-day learning steps for new cards; the scheduler accepts `learningSteps`.

### D-079 · Task checks are Node test files; every code task ships a reference solution — Accepted, 2026-11-18
- **Chosen:** `checks/*.test.mjs` run with `node --test`, using Node built-ins only. Each top-level test is one criterion and its name starts with the criterion id. Each code task has a hidden `solution/` folder, and the checks must pass against it and fail against `starter/`.
- **Why:** no custom check framework to learn or maintain, and the reference solution proves that a check can actually be satisfied before a learner meets it.
- **Alternatives:** a bespoke check DSL in YAML (less flexible); Vitest inside the sandbox (needs packages the sandbox cannot download).

### D-080 · Sandbox runner images carry the dependencies — Accepted, 2026-11-18
- **Why:** the sandbox has no internet, so a NestJS submission cannot run `npm install` there.
- **Chosen:** each task names a runner (`node` or `nest` so far). The `nest` image has the packages in `infra/docker/runner-nest/package.json` pre-installed, and the sandbox links them into the submission.
- **Consequence:** tasks can only use packages their runner provides. The task brief lists them.
- **Alternatives:** allow internet during an install phase (breaks the isolation rule); ask learners to commit `node_modules` (no).

### D-081 · Request validation uses Nest's `StandardSchemaValidationPipe`, registered globally — Accepted, 2026-11-18
- **Found while building:** in NestJS 12, `@Body({ schema })` only attaches the schema. Nothing is validated until the pipe is registered. A test caught invalid input reaching the database.
- **Chosen:** register the pipe once with `APP_PIPE`, and map its issues into the `errors` array of the problem-details response.

### D-082 · "Today" for review limits is the machine's local day — Accepted, 2026-11-18
- **Why:** the platform runs on the learner's own computer, so local midnight is the natural boundary. UTC would move the boundary to mid-evening or mid-morning.

### D-083 · New core module 13, "LLM features in a backend", placed after observability — Accepted, 2026-11-18
- **Source:** the market research found that LLM integration is now a common line in fullstack postings. The request to make it core and place it after observability came through the project coordinator, not from Ihor directly, so this is the first thing to confirm.
- **Covers:** provider SDKs, streaming, tool calling, RAG with pgvector, evaluating output, prompt injection, MCP.
- **Cost:** one more M-sized core module. Practice uses the learner's Claude plan or a local model, so still no API key.
- **Alternatives:** optional module (skippable without breaking later tasks); leave it out.
- **Revisit if:** you would rather it be optional. That is a one-word change in `module.yaml` and the spec table.

### D-084 · Optional module 19, "Interview prep", and interview questions mapped into every module — Accepted, 2026-11-18
- **Source:** `docs/interview-questions.md`, requested through the coordinator.
- **Chosen:** high-frequency questions become cards tagged `interview` in the module they belong to, scenario questions become written tasks, and the interview-only formats (mock design, take-home, code review, behavioural stories, light algorithms) live in an optional last module.
- **Alternatives:** a single separate question bank (would repeat lesson content and be reviewed out of context).

### D-085 · Curriculum widened with small-team tools and missing topics — Accepted, 2026-11-18
- **Source:** section 5 of `docs/market-research-fullstack-backend.md` and the coverage gaps in the interview research, requested through the coordinator.
- **Added as lessons inside existing modules:** framework landscape (Express, Hono, Next.js route handlers); real-time with WebSockets and SSE; tRPC; passkeys; multi-tenancy; build or buy for auth (Better Auth, managed providers); hosted jobs (Inngest or Trigger.dev); full-text search; zero-downtime migrations and deploys; Node performance diagnosis; transactional email with Mailpit; Vitest to Jest mapping; Confluent's Kafka client in place of `kafkajs`.
- **Optional because they need an outside account or are off the main path:** Sentry, deploying to Railway or Fly, MongoDB, Row-Level Security.
- **Cost:** about 14 more lessons. No new always-on service: Mailpit is tiny and pgvector is an extension in the lab Postgres.

### D-086 · Modules renumbered: 13 is the LLM module, old 13 to 17 become 14 to 18 — Accepted, 2026-11-18
- **Why:** numbers follow the recommended order. Only modules 0 to 2 are authored, so nothing on disk moves.
- **Note:** the interview research file still uses the old numbers. The spec, section 5.1, has the mapping.

### D-087 · The linter skips the `curriculum` folder — Accepted, 2026-11-18
- **Why:** starter files are unfinished on purpose (unused parameters, empty bodies), which the linter reports as errors.
- **Safeguard:** curriculum quality is checked another way: `pnpm curriculum:check` validates structure, and every check must pass against the reference solution.

### D-088 · Lost database connections are logged, not fatal — Accepted, 2026-11-18
- **Found by:** the QA pass. The API exited when Postgres restarted, and the dev watcher did not bring it back.
- **Chosen:** the pool reports the error and opens a new connection on the next query. Confirmed by restarting Postgres under a running API.

### D-089 · The bridge is a small plain Node server, not a NestJS app — Accepted, 2026-11-18
- **Why:** it is the one process with access to Docker and, later, the Claude login. Fewer dependencies means less to audit. It has three routes.
- **Rules it enforces:** listens on loopback only; requires the shared secret; rejects requests addressed to any host name other than localhost (stops a web page from reaching it through DNS tricks); never takes a command, image name or mount path from a request, only a task id that it looks up in the curriculum; runs every program with an argument list and no shell; one sandbox at a time.
- **Alternatives:** NestJS like the API (consistent, but heavier than the job needs).

### D-090 · `pnpm dev` creates `.env` and generates the bridge secret — Accepted, 2026-11-18
- **Why:** a secret copied from `.env.example` would be the same on every install. Generating it also removes the manual "copy the example file" step.
- **Detail:** `scripts/ensure-env.mjs` never changes a value that is already set.

### D-091 · The worker is a plain Node process using pg-boss — Accepted, 2026-11-18
- **Changed from the spec:** the spec said "NestJS standalone app". The worker has one job type so far and needs no framework.
- **Behaviour:** each failure is written onto the run, in words the learner can act on (lab path not set, bridge not running, commit not found, image not built). The queue does not retry, because a retry would only repeat the same outcome.
- **Revisit if:** the worker grows several job types that share services.

### D-092 · "Run checks" without a commit id checks the latest commit — Accepted, 2026-11-18
- **Why:** pasting a commit id every time is friction. The bridge resolves the latest commit and the platform records exactly which one was checked.
- **Kept:** uncommitted changes are never checked, so a result always refers to something reproducible.

### D-093 · Lab services: two networks, pgvector image, no service starts by default — Accepted, 2026-11-18
- **Networks:** `lab-net` has no internet and is the only one sandboxes join. Services also join an ordinary network, because a port cannot be published from a network without outside access.
- **Images:** lab Postgres uses `pgvector/pgvector:pg18` so the LLM module needs no second database. The AWS emulator is `floci/floci`. Both tags were confirmed to exist. They are not yet started and exercised here; that happens when the modules that use them are authored.
- **Not yet in the file:** the observability stack, Keycloak and the Lambda-capable emulator. They are added with their modules.

### D-094 · The lab folder for a task is `<module>/<task>` at the root of the lab repository — Accepted, 2026-11-18
- **Why:** the task id is already that path, so one string identifies the task everywhere. `pnpm lab start` also writes the brief as `TASK.md` next to the starter files.

### D-095 · Bridge rules from the security review (S-012) — Accepted, 2026-11-18
- **Source:** `docs/security-decisions.md` in the security review pull request, passed on by the coordinator.
- **Already in place:** no shell, argument lists, `--` before paths, constant-time secret comparison, host-name check, generated secret.
- **Added now:** requests that carry an `Origin` header are refused.
- **Two deliberate differences:** a commit id may be 7 to 40 hex characters (hex only, so it cannot carry an option; the bridge resolves it to the full id before use), and `host.docker.internal` stays an accepted host name because the worker uses it in full Docker mode.
- **Still to do, tracked here:** S-011 applies when one-click review is built (CLI flags, strip `.claude/`, `.mcp.json` and `CLAUDE.md` from the export). S-010 applies when the Lambda profile is added (socket proxy, separate network). S-013: pin images by digest. Remove the temporary package release-age exceptions after 2026-11-19 08:00 UTC.

### D-096 · Copy-paste review of code tasks is done in Claude Code inside the lab repository — Accepted, 2026-11-18
- **Chosen:** for a code task the prompt names the task folder and the commit, and Claude Code reads the files itself. For a written answer the prompt contains the answer, so claude.ai works too.
- **Why:** pasting a whole solution into a chat is clumsy and hits length limits, and the API process has no access to the lab repository by design.
- **Alternatives:** have the bridge inline every file into the prompt (works in claude.ai, but long and needs the bridge running).
- **Validation:** a pasted reply is accepted only if it is valid JSON in the expected shape, has exactly one score per rubric item, and no score exceeds its maximum. Otherwise the page lists what is wrong so Claude can be asked to correct it.
- **Suggested cards** are stored as "waiting for approval" and stay out of the review queue until approved on the Cards page.

### D-097 · When a task counts as done — Accepted, 2026-11-18
- **Code task with automated checks:** done when any submission passes all checks.
- **Task without checks (written answers, for now diagrams):** done when an answer is saved. A Claude review is encouraged but not required, because review is optional by design (no API key, copy-paste by default).
- **Revisit if:** you want a minimum review score before a written task counts.

### D-098 · Time tracking counts active seconds only — Accepted, 2026-11-18
- **Chosen:** the browser counts a second only when the tab is visible and there was keyboard, pointer or scroll input in the last 3 minutes. A session is recorded after 5 active seconds, and the count is sent every 20 seconds.
- **Why:** wall-clock time between opening and closing a page overstates study time badly (a tab left open overnight).
- **Limit:** time spent in the editor and terminal on a task is not seen. Task time therefore means time on the task page.
- **Alternatives:** manual timers (friction); tracking through the lab repository's commit times (coarse and misleading).

### D-099 · "Next up" order and the weak-skill trigger — Accepted, 2026-11-18
- **Order on the plan page:** card reviews, skills that need a refresh, the next lesson (core modules first, optional modules never block), open tasks of modules already started, cards waiting for approval.
- **Weak skill:** as defined in the spec (at least 10 qualifying reviews in 30 days and retention more than 10 points under the target). It is re-evaluated after every card review. A refresh item links to the first lesson that teaches the skill, closes by itself when retention recovers, and can be dismissed.
- **Statistics definitions:** "young" and "mature" split at a 21-day interval, as in Anki. Streaks count local days and stay alive until the end of the following day.

### D-100 · One-click review: how the Claude CLI is run — Accepted, 2026-11-18, needs a test on your Mac
- **Follows:** security rule S-011. The CLI runs with `--setting-sources user`, an empty MCP configuration with `--strict-mcp-config`, tools limited to `Read,Grep,Glob`, `Bash,Edit,Write,WebFetch,WebSearch` disallowed, `--permission-mode dontAsk`, and no saved session. Its working directory is a temporary export of the task folder at the submitted commit, with `.claude/`, `.mcp.json` and `CLAUDE.md` removed. The prompt goes in on standard input.
- **Why:** project settings in a folder can define hooks that run shell commands on the host. The folder under review must not be able to steer the reviewer.
- **Orchestration:** the API starts the review and calls the bridge in the background, because the API owns the rubric validation. One retry on an unusable reply, then a clear message and the copy-paste option.
- **What is verified:** every flag exists in the CLI's help text (version 2.1.327), and the whole flow passes with a stand-in program in place of the CLI.
- **What is not verified:** a real run with your Claude login. I did not run the real CLI here, because it would have used this session's credentials. The setting is off by default (Settings, "Claude review"). Please try it once on a task; if the CLI answers in a different shape, the page shows the error and copy-paste still works.
- **Dropped:** `--max-turns`, which this CLI version does not list. The bridge stops a review after 6 minutes instead.

### D-101 · Full Docker mode — Accepted, 2026-11-18, bridge link needs a test on your Mac
- **What it is:** `pnpm full:up` builds and runs the API, worker and web app as containers (web on http://localhost:8080). Each runs read-only, without capabilities, with a memory limit. Measured here: about 170 MiB in total, plus Postgres.
- **Verified:** the three images build, the stack starts healthy, pages and API answer through the web container.
- **Not verified:** the containers reaching the host bridge at `host.docker.internal`. That name exists on Docker Desktop and OrbStack for macOS, not in the Linux environment this was built in. If checks show "bridge not running" in full mode while `pnpm bridge` is up, tell me.
- **The curriculum is baked into the API image,** so a content change needs a rebuild in full mode. Dev mode reads the files directly.
- **Web server:** an unprivileged nginx image that serves the built files and passes `/api` to the API container.

### D-102 · Second round of QA fixes — Accepted, 2026-11-18

**Decided:** Fixed the seven findings from the second QA pass.

- A card that is not new and not yet due cannot be graded (`409`). This stops a second tab or a retry from recording a second grade. Alternative: send the expected `reps` with the grade. Rejected because "not due" needs no client change and also blocks grading cards outside the queue.
- Writes to the API must carry `application/json`, and an `Origin` header, when present, must be `WEB_ORIGIN` (or its `localhost` / `127.0.0.1` twin). Requests with no `Origin`, such as curl, still work. Alternative: a CSRF token. Rejected as more moving parts than a single-user local app needs.
- Settings accept only the review modes that exist (`copy_paste`, `bridge`) and an absolute lab path or none.
- A lesson or task address that does not exist shows "Page not found" inside the normal layout.
- An emptied number field on Settings no longer saves 0, and the Cards form says so when the text is only spaces.
- `apps/web/.tanstack/` is ignored by git.

### D-103 · Third round of QA fixes — Accepted, 2026-11-18
- A one-click review cannot be started while another one is running for the same submission (`409`). Before, each request started the Claude CLI again.
- Settings shows the field message from a failed save, not only "Request validation failed".
- The last study-time update is sent with `keepalive` on `pagehide` and when the tab is hidden, so closing a tab no longer loses up to 20 seconds.

### D-104 · Kubernetes and Kafka are theory modules with self-practice sections — Accepted, 2026-11-18
- **Asked for:** both topics in the path at least as theory, with no Docker practice environment.
- **Built:** module 16 (7 lessons, 78 cards, 4 written tasks) and module 17 (5 lessons, 59 cards, 3 written tasks). All tasks are written answers reviewed by Claude against a rubric. Each module ends with a "practise on your own" section (`kind` for Kubernetes, a single-node KRaft broker for Kafka).
- **Verified:** every Kubernetes manifest validates against the 1.37 schemas and Gateway API v1.5. The Kafka code examples ran against a real Kafka 4.4 broker with `@confluentinc/kafka-javascript` 1.11.

### D-105 · Images are pinned by digest (security rule S-013) — Accepted, 2026-11-18
- **Chosen:** every image in the Compose files and Dockerfiles carries its `sha256` digest next to a readable tag. The AWS emulator and Mailpit moved from `latest` to the versions tested here (floci 2.5.0, Mailpit 1.34.0).
- **Why:** a tag can be repointed to different content; a digest cannot. This also makes check results repeatable.
- **Verified:** each digest is a multi-architecture index that includes `arm64`, so it works on Apple Silicon.
- **Cost:** updates are manual. To update, pull the new tag, read its digest with `docker image inspect --format '{{index .RepoDigests 0}}'`, and replace it.
- **Runner packages added the same day:** BullMQ, ioredis, express, AWS SDK v3 clients, nodemailer and Stripe, each at an exact version at least a day old. Run `pnpm lab images` again after pulling.

### D-106 · The capstone is a written report on a project built in the lab repository — Accepted, 2026-11-18
- **Chosen:** module 18's capstone ("Shoebox", a receipts inbox for small teams) is a brief with nine milestones and 40 numbered acceptance criteria that you check yourself. What you submit is a 1,200 to 2,000 word report with the commit, and Claude reviews it against a rubric.
- **Why:** automated checks for a whole SaaS would force one fixed structure on a project whose point is making your own design decisions.
- **Alternative:** hidden end-to-end checks per milestone. Rejected for the reason above, and because the earlier modules already check each building block.
- **One task is hard on purpose:** in the report scheduler design task, the load does not fit the read replica's stated limit. The expected answer notices that and pushes back. Say so if you would rather have numbers that fit.

### D-107 · Module 15 (infrastructure as code) was written without running OpenTofu — Accepted for now, 2026-11-18, needs a real run
- **What happened:** the build environment's network rules block OpenTofu's download and registry hosts, so OpenTofu could not be installed. I did not work around that.
- **What is in the module:** six lessons and four tasks. Every resource, argument and command was checked against the official OpenTofu and AWS provider documentation. The two code tasks are checked by reading the `.tf` files (structure, variables, backend, `moved` blocks, no hard-coded credentials). The checks do not run OpenTofu, because the check sandbox has no internet for provider downloads either.
- **What is not verified:** that `tofu validate`, `plan` or `apply` accept these files, and that the lab AWS emulator supports every call the provider makes (including the conditional writes that S3 state locking needs). No output in the module is presented as captured from a real run; the one plan excerpt is labelled as illustrative.
- **Alternatives:** leave the module out until it can be run (rejected: the path would have a hole, and a later run can correct it); checks based on a plan file you commit (rejected: I could not produce a real one to test the checks against).
- **To close this:** run the walkthrough in lesson 6 and both task solutions with OpenTofu on your machine, or allow the hosts in the project's cloud environment so I can.

### D-108 · OpenTofu stays in the curriculum and is installed by the learner — Decided by Ihor, 2026-11-18
- **Decision:** module 15 keeps teaching OpenTofu as written. Nothing is added to the platform, the check images or the build environment. A learner who wants to run the examples installs OpenTofu themselves (`brew install opentofu`); lesson 6 says so.
- **Consequence:** D-107 still holds. The module's configuration has not been run by me, and its task checks read the files only.
- **Options offered:** keep as is (chosen), make it a theory-only module, or remove it.

### D-109 · The pnpm release-age rule gets no exceptions — Decided by Ihor, 2026-11-18
- **Decision:** no package version is ever exempted from the one-day release-age rule again. If a release is too new, use the previous version or wait a day.
- **Done the same day:** the twelve existing exemptions are removed. turbo went back from 2.11.12 to 2.11.11 and vitest from 5.1.1 to 5.1.0, both pinned exactly in the catalog. TanStack Query 5.108.0 was already more than a day old, so it stays. `pnpm install --frozen-lockfile` passes with no exemption list. This replaces the temporary rule S-002 in `docs/security-decisions.md`.

### D-110 · Security and research pull requests merged into the build branch — 2026-11-18
- **What:** PR #2 (market research) and PR #3 (supply-chain policy, CI hardening) were merged into this branch on Ihor's instruction that green CI means a pull request can be merged.
- **Follow-up done in the same step:** the lock file for the check image (`infra/docker/runner-nest/package-lock.json`) was regenerated, because this branch had added packages to that image after PR #3 was written. The image now installs with `npm ci` and install scripts off.

### D-111 · The handoff document is removed — Decided by Ihor, 2026-11-18
- **What:** `docs/HANDOFF.md` is deleted. It was the note that started this build and is no longer needed.
- **Kept:** its section of decisions agreed with Ihor is copied below without changes. The original draft brief (draft v0) is not kept; `technical-spec.md` replaced it, and the old text stays in the git history.

### D-112 · `main` is the main branch — Decided by Ihor, 2026-11-18
- **What:** a `main` branch is created from the branch that held the handoff, and the build is merged into it.

### D-113 · Work continues as small pull requests into `main` — Decided by Ihor, 2026-11-18
- **What:** each improvement is one pull request with one purpose, branched from `main` and merged when CI is green. Testers and reviewers send findings, which are triaged here.

### D-114 · Search is a scan of the curriculum held in memory — 2026-11-18
- **What:** a Search page finds lessons and tasks by words in the title or the text. Every word must appear on the page, title matches rank first, and at most 20 results are shown with a snippet.
- **Why:** with 130 lessons, the plan page alone does not answer "where was idempotency explained". The API already holds every page in memory, so a scan answers in about a millisecond.
- **Alternatives:** PostgreSQL full-text search (needs the lesson text copied into the database and kept in step with the files) and a client-side index (ships every lesson to the browser). Both are more moving parts for no gain at this size.
- **Limits:** no stemming or typo tolerance, and flashcards are not searched.
### D-115 · CI validates the real curriculum — 2026-11-18
- **What:** the `verify` job runs `pnpm curriculum:check`.
- **Why:** the tests load a small fixture curriculum, so a broken `task.yaml` or card file under `curriculum/` passed CI and then stopped `pnpm dev`, because the API refuses to start on a content problem. Found by the code review (R1).
### D-116 · The worker fails check runs it finds running at start-up — 2026-11-18
- **What:** before taking jobs, the worker marks every check run still in `running` as an error with "The checker restarted while this run was in progress. Submit again."
- **Why:** jobs are not retried, so a run interrupted by a crash or a closed laptop stayed `running`. The task page polled for ever and that submission could never be reviewed. Found by the code review (R2a).
- **Alternatives:** retrying the job. A check run is cheap to submit again, and a retry could run checks against a commit the learner has already moved past.
- **Limits:** assumes one worker. With several, a start-up sweep would fail runs another worker is still processing.

### D-117 · A submission whose checks cannot be queued gets a failed run — 2026-11-18
- **What:** if putting the check job on the queue fails, the run is marked as an error with "The checks could not be queued. Submit again." and the submission is returned as usual.
- **Why:** the run row is saved before the job is sent. When sending failed, the request answered 500 but the run stayed `queued` with no job behind it. Found by the code review (R2b).
- **Alternatives:** sending the job inside the same transaction through pg-boss's `db` option. It needs an adapter between pg-boss and the Drizzle transaction, which is more code than this failure deserves.

### D-120 · A pasted review reply is stored once — 2026-11-18
- **What:** storing a review result now claims the run in the same statement (`status <> 'passed'`), inside the transaction. A second reply for the same review gets 409. `rubric_scores` has a unique index on run and rubric item, and the migration removes duplicates that already exist.
- **Why:** two replies arriving together (a double click, two tabs) both passed the "already has a result" check and stored the scores and the suggested cards twice. Found by the code review (R3) and the backend tester (BE-3).
### D-121 · The bridge keeps only the tail of a program's output while it runs — 2026-11-18
- **What:** `exec()` drops old output chunks as new ones arrive and never holds more than the output limit plus one chunk per stream.
- **Why:** it used to keep every chunk and trim at the end. A submission printing in a loop grew the bridge from 98 MB to 12.7 GB in a minute until the kernel killed it, which also failed every queued run. Found by the backend tester (BE-1).
### D-122 · The API reads JSON bodies up to 1 MB — 2026-11-18
- **What:** the JSON body limit is 1 MB instead of the framework default of 100 kB.
- **Why:** the schemas allow a 90,000-character review reply and a 50,000-character answer. With JSON escaping or Cyrillic text those pass 100 kB and were refused with 413 before validation ran. Found by the backend tester (BE-4).

### D-123 · The API answers only requests addressed to this machine — 2026-11-18
- **What:** a request whose `Host` header is not `localhost`, `127.0.0.1`, `[::1]` or the host of `WEB_ORIGIN` gets 403. The bridge already did this.
- **Why:** the API has no login and relies on being reachable from this machine only. A web page on a domain re-pointed at 127.0.0.1 (DNS rebinding) counts as the same origin as the API and could read settings, cards and answers. Writes were already protected by the Origin check. Found by the backend tester (BE-5).
- **Full Docker mode:** nginx passes the browser's `Host` on, so the same rule holds there.

### D-124 · A grade succeeds even if the weak-skill update fails — 2026-11-18
- **What:** the grade endpoint logs a failure of the weak-skill evaluation and still answers with the saved grade. `review_tasks` has a partial unique index, one open refresh per skill, and the evaluation ignores a conflict.
- **Why:** the evaluation runs after the grade is committed. If it failed, the client saw a 500, and a retry was refused because the card was no longer due. Two evaluations at once could also open two refreshes for the same skill. Found by the code review (R4).

### D-125 · A check run may write at most 1 MB of results — 2026-11-18
- **What:** the bridge watches the results folder while a run is in progress and stops the container when it passes 1 MB. A results file over the limit is never read. The run is reported as failed with a message that says why. The error output of `git archive` is also kept as a tail only.
- **Why:** the results folder is the one place the sandbox writes on the host, and the submission's own code runs there. It could fill the disk for the whole time limit, and the bridge then read the file into memory in one go. Found by the code review, as a follow-up to BE-1.
- **Links and special files:** the sandbox controls what is in that folder, so the results file is opened without following links and read through the same handle that was checked. A symbolic link, a named pipe or a device anywhere in the folder fails the run.
- **Known limit:** the size is polled once a second, so a fast writer can pass 1 MB by a wide margin before the container is stopped. It is bounded by disk speed and the run's time limit.
- **Alternatives:** a small tmpfs for results, copied out with `docker cp`, would be the strict fix. It needs the container to outlive the run, which changes how runs are cleaned up.

### D-118 · A task without automated checks is done only after a review — 2026-11-18
- **What:** a written task, or a code task with no check suite, counts as done once a Claude review of one of its answers is stored. A saved answer alone shows as in progress, and the answer says "counts as done after a Claude review".
- **Why:** saving two words marked the task as finished on the Plan and in the statistics. Found by the UX review.
- **Alternatives:** a "mark as done" button for learners who skip reviews. Not added: every task has a rubric, and the copy-and-paste review needs no setup.
- **Effect on existing data:** answers saved without a review go back to in progress.
### D-119 · "Run checks" is disabled until the lab repository path is set — 2026-11-18
- **What:** on a code task with checks, the task page says to set the lab repository path and links to Settings, and the button is disabled until the path exists.
- **Why:** a new learner's first submission could only fail with "set the path", and that failed attempt was stored. Found by the UX review.
- **Scope:** the web app only. The API still accepts the submission and the worker still reports the missing path, so a direct API call behaves as before.

### D-126 · The Plan shows a getting-started panel until setup is done — 2026-11-18
- **What:** above "Next up", three steps with their state: build the check images, create the lab repository and set its path, read a first lesson. Commands have a copy button. The panel goes away once the path is set and a lesson is done, or when the learner hides it (remembered in the browser).
- **Why:** a new learner saw 20 modules and nothing about setup, and found out at the first code task. Found by the UX review.
### D-127 · A check run says when it ran out of memory — 2026-11-18

A submission that used more memory than its task allows had every criterion marked "stopped before this one reported a result", with nothing saying why. The test runner itself survives (the kernel kills the child process), so the exit code does not show it. The sandbox container is now started without `--rm`; after it exits the bridge reads `State.OOMKilled` from `docker inspect`, reports "The checks ran out of memory" with the task's limit, and removes the container itself. Checked with a suite that allocates without bound under a 128 MB limit.

---

## Agreed before this log

These were agreed with Ihor in the session before this log existed. They are copied from the handoff document as they were written.

#### Scope and pacing
- **No fixed schedule; fully self-paced.** Remove week estimates, the weekly hour budget, the projected finish date and the "hours logged vs planned" stats. The plan becomes a recommended order plus progress, and stats show time actually spent. The curriculum is a starting point, and learners can go deeper or skip.
  - Note for the next session: the original brief asks for "week estimates at 10 h/week" in the curriculum. That is superseded. At most, give a rough relative-effort indicator such as S/M/L per module.
- **Add topics proactively.** Add any modules that are needed, for example API design (REST conventions, OpenAPI, pagination, versioning, error formats, idempotency), reliability and distributed patterns (outbox, retries and backoff, sagas, concurrency control), and Kubernetes as an optional elective (`kind` or `k3d`, no account). Mark modules as core or optional so learners can skip what isn't relevant.
- **Claude writes the lesson content for ALL modules** in Phase 2: concise original lessons with links to official docs, written in batches, module by module. This changes the MVP definition of done, which previously covered only modules 0–2.

#### Resource tiers (the user wants this to work on low-RAM machines too)
- The user has an M4 with 24 GB RAM, but the platform must work on weaker Macs.
- **Core tier:** web, API and worker plus **one Postgres**. That's enough for lessons, flashcards and copy-paste verification. Consider a Postgres-backed queue (**pg-boss**) for the platform's own jobs so the core doesn't need Redis; verify this in research. Target about 1 GB RAM.
- **Practice add-ons:** each module declares the services it needs (Compose profiles), and the learner starts them only for hands-on practice, e.g. `pnpm lab up postgres redis`. Without them a module still works as reading plus flashcards.
- **Heavy extras are opt-in:** the observability stack and the identity provider (e.g. Keycloak).

#### Lab vs platform isolation
- **The lab gets its own AWS emulator instance**, separate from anything the platform uses. Lab Postgres and Redis are separate too, as in the draft.
- **Lab layout:** one lab git repo with **plain folders per module and task**, not git submodules. Example: `lab/m02-postgres/t03-indexes/`. Each task folder is self-contained. A submission is the folder path plus a commit SHA, and checks only see that folder.

#### Host bridge (option D, chosen)
- A small **native host bridge** process (Node, runs on macOS) is the **only** component that:
  1. runs the Claude Code CLI headless (it depends on the user's local Claude login), and
  2. launches sandbox containers through Docker.
- The worker always calls the bridge, in both dev mode and full mode. The worker never touches the Docker socket.
- Sandbox containers get:
  - **Network:** only an internal `lab-net` network (lab Postgres, Redis and AWS emulator). No internet and no access to the platform DB.
  - **Limits:** `--memory`, `--cpus`, `--pids-limit` and a hard timeout.
  - **Hardening:** a non-root user, `--cap-drop ALL`, `no-new-privileges`, and a read-only root filesystem with a tmpfs work directory.
  - **Code:** the task folder at the submitted commit, mounted read-only.
- Threat model: accidents (a stray `DROP SCHEMA`, a wrong DB URL, runaway loops, `down -v`), not malicious code.

#### Claude verification (Pro plan, no API key)
- Target the **Claude Pro plan** at minimum. **No Anthropic API key is assumed.**
- There are two verification modes behind one provider interface:
  1. **"Copy for Claude" (manual, zero setup).** The platform builds a prompt containing the task spec, the rubric, the diff from the lab repo, the stage 1 results and the required JSON schema. The user pastes it into claude.ai or Claude Code, then pastes the JSON reply back. The platform validates it with zod and stores it.
  2. **One-click review through the bridge.** The bridge runs `claude -p` headless with read-only tools and JSON output, using the user's Pro subscription. Research must confirm that subscription auth works headless, plus any usage-limit or ToS caveats.
- The **Anthropic API provider** stays as an interface slot only and is **not built in the MVP**. Still research it briefly (models, pricing, structured outputs, rough cost per run) for completeness.
- Free-recall flashcard grading by Claude works only through mode 2, since copy-paste per card is too tedious. Otherwise the learner grades themselves.

#### Spaced repetition
- Use **standard FSRS** (e.g. ts-fsrs; verify).
- **Retention rate** follows the standard FSRS definition: the share of reviews not graded "Again".
- Store every review in Postgres so schedules can be recomputed.

#### CI/CD
- The **platform repo itself** gets a real GitHub Actions pipeline: lint, typecheck, test, build and Docker images. GitHub is fine; the repo is on GitHub.
- **Task verification never runs in CI.** It is always local, through the worker and the bridge.
- The CI/CD **curriculum module's exercises** target the learner's own lab or capstone project. Offer `act` as an offline path.

#### Output location
- Phase 1 documents are committed as markdown in this repo under `docs/` and pushed to GitHub.

#### Assumptions (not explicitly confirmed, defaults accepted)
- macOS on Apple Silicon.
- Real GitHub Actions is allowed, with an `act` offline path.
- The curriculum leans toward preparing for a backend job switch, so weight the industry/job-posting check accordingly.
