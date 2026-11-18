# Session handoff: Backend self-study platform

> **Update 2026-11-18:** Phase 1 research is done. See [`stack-decisions.md`](./stack-decisions.md), [`technical-spec.md`](./technical-spec.md) and the decision log in [`decisions.md`](./decisions.md). The "stop and wait for approval" rule below no longer applies: Ihor asked for the build to proceed with decisions logged. The rest of this file is kept as the record of the earlier session.

**Status as of 2026-11-18:** The clarification Q&A is finished and every decision is recorded below. **Phase 1 research had not started yet**: the research subagents were cancelled before they ran, so no findings exist. The repo is empty except for this file.

**What the next session should do:** run Phase 1 research (section 4) using the original brief (section 5) **as amended by the decisions in section 2**. Deliver the output to `docs/` in this repo, then **stop and wait for approval** before Phase 2 (build).

- Branch to work on: `claude/admiring-dirac-jffo8u`
- Phase 1 deliverables (markdown, committed to the repo):
  - `docs/stack-decisions.md`: the Stack Decision Record table plus sources
  - `docs/technical-spec.md`: the revised technical doc (v1), the revised curriculum, open questions and sources

---

## 1. Problems found in draft v0 (all resolved in section 2)

1. **Schedule length.** The curriculum added up to about 24 weeks, closer to 28 once daily reviews are counted.
2. **Missing topics.** The draft had no API design module, no reliability patterns module (outbox, retries, sagas, concurrency control) and no Kubernetes.
3. **Shared AWS emulator.** The platform stored diagrams in the same AWS emulator the lab tasks use, so a lab exercise could destroy platform data.
4. **Full mode vs. the Claude CLI provider.** The CLI provider must run on the host, but in full mode the worker runs inside Docker.
5. **Sandbox Docker access.** The worker needs the Docker socket to launch sandboxes, which effectively gives it control over all containers.
6. **Unclear time budget.** It was unclear whether time spent extending the platform itself counts toward the 10 h/week budget.
7. **Fuzzy definitions.** "Retention rate" and the "weak recall → review task" trigger were not defined precisely.

## 2. Decisions made with the user (these override the draft in section 5)

### Scope and pacing
- **No fixed schedule; fully self-paced.** Remove week estimates, the weekly hour budget, the projected finish date and the "hours logged vs planned" stats. The plan becomes a recommended order plus progress, and stats show time actually spent. The curriculum is a starting point, and learners can go deeper or skip.
  - Note for the next session: the original brief asks for "week estimates at 10 h/week" in the curriculum. That is superseded. At most, give a rough relative-effort indicator such as S/M/L per module.
- **Add topics proactively.** Add any modules that are needed, for example API design (REST conventions, OpenAPI, pagination, versioning, error formats, idempotency), reliability and distributed patterns (outbox, retries and backoff, sagas, concurrency control), and Kubernetes as an optional elective (`kind` or `k3d`, no account). Mark modules as core or optional so learners can skip what isn't relevant.
- **Claude writes the lesson content for ALL modules** in Phase 2: concise original lessons with links to official docs, written in batches, module by module. This changes the MVP definition of done, which previously covered only modules 0–2.

### Resource tiers (the user wants this to work on low-RAM machines too)
- The user has an M4 with 24 GB RAM, but the platform must work on weaker Macs.
- **Core tier:** web, API and worker plus **one Postgres**. That's enough for lessons, flashcards and copy-paste verification. Consider a Postgres-backed queue (**pg-boss**) for the platform's own jobs so the core doesn't need Redis; verify this in research. Target about 1 GB RAM.
- **Practice add-ons:** each module declares the services it needs (Compose profiles), and the learner starts them only for hands-on practice, e.g. `pnpm lab up postgres redis`. Without them a module still works as reading plus flashcards.
- **Heavy extras are opt-in:** the observability stack and the identity provider (e.g. Keycloak).

### Lab vs platform isolation
- **The lab gets its own AWS emulator instance**, separate from anything the platform uses. Lab Postgres and Redis are separate too, as in the draft.
- **Lab layout:** one lab git repo with **plain folders per module and task**, not git submodules. Example: `lab/m02-postgres/t03-indexes/`. Each task folder is self-contained. A submission is the folder path plus a commit SHA, and checks only see that folder.

### Host bridge (option D, chosen)
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

### Claude verification (Pro plan, no API key)
- Target the **Claude Pro plan** at minimum. **No Anthropic API key is assumed.**
- There are two verification modes behind one provider interface:
  1. **"Copy for Claude" (manual, zero setup).** The platform builds a prompt containing the task spec, the rubric, the diff from the lab repo, the stage 1 results and the required JSON schema. The user pastes it into claude.ai or Claude Code, then pastes the JSON reply back. The platform validates it with zod and stores it.
  2. **One-click review through the bridge.** The bridge runs `claude -p` headless with read-only tools and JSON output, using the user's Pro subscription. Research must confirm that subscription auth works headless, plus any usage-limit or ToS caveats.
- The **Anthropic API provider** stays as an interface slot only and is **not built in the MVP**. Still research it briefly (models, pricing, structured outputs, rough cost per run) for completeness.
- Free-recall flashcard grading by Claude works only through mode 2, since copy-paste per card is too tedious. Otherwise the learner grades themselves.

### Spaced repetition
- Use **standard FSRS** (e.g. ts-fsrs; verify).
- **Retention rate** follows the standard FSRS definition: the share of reviews not graded "Again".
- Store every review in Postgres so schedules can be recomputed.

### CI/CD
- The **platform repo itself** gets a real GitHub Actions pipeline: lint, typecheck, test, build and Docker images. GitHub is fine; the repo is on GitHub.
- **Task verification never runs in CI.** It is always local, through the worker and the bridge.
- The CI/CD **curriculum module's exercises** target the learner's own lab or capstone project. Offer `act` as an offline path.

### Output location
- Phase 1 documents are committed as markdown in this repo under `docs/` and pushed to GitHub.

### Assumptions (not explicitly confirmed, defaults accepted)
- macOS on Apple Silicon.
- Real GitHub Actions is allowed, with an `act` offline path.
- The curriculum leans toward preparing for a backend job switch, so weight the industry/job-posting check accordingly.

## 3. Where the session stopped

- The user said "go" for Phase 1.
- Four parallel research subagents were about to launch when the user interrupted to request this handoff. **No research results exist.**
- Nothing has been scaffolded, and no code has been written.

## 4. Planned Phase 1 research split (suggested; reuse or adapt)

Verify everything with live web searches (today ≈ 2026-11-18) and give a source URL for every version number and non-obvious claim. Suggested parallel groups:

- **A. Runtime and app stack:** Node LTS, TypeScript (incl. TS 7 / native port status), pnpm/npm/bun, monorepo tooling (pnpm workspaces, Turborepo, Nx), NestJS major version and patterns (config, validation with class-validator vs zod, Fastify vs Express 5, SWC), React, Vite, routing (TanStack Router vs React Router 7), TanStack Query, UI kit (shadcn/ui + Tailwind 4), charts, markdown/MDX + shiki, PostgreSQL version, ORMs (Prisma 6/7, Drizzle, TypeORM, MikroORM, Kysely) for learning value and industry use, migrations, testing (Jest vs Vitest with NestJS, Supertest, Testcontainers, API e2e).
- **B. AWS emulation and IaC:** LocalStack's March 2026 change (verify), Floci, LocalEmu, Moto server, MinIO (note its 2025 licensing/distribution changes; alternatives Garage, SeaweedFS, Versity), ElasticMQ, DynamoDB Local, pinning the last auth-free LocalStack image. Build a coverage matrix for S3, SQS, SNS, Lambda, IAM, DynamoDB, Secrets Manager/SSM, CloudWatch Logs and EventBridge. Cover persistence, arm64 support, RAM (two instances will run), and compatibility with SDK v3, CLI v2, Terraform/OpenTofu and CDK. For IaC compare Terraform, OpenTofu, CDK (cdklocal) and Pulumi (local backend).
- **C. Stripe, Redis, auth, observability:** current Stripe API version, sandboxes vs test mode, Stripe CLI (Docker image, arm64), test clocks, Node SDK, Checkout vs Payment Element, Event Destinations / v2 events. Redis license history vs Valkey, BullMQ, pg-boss (as the core queue), NestJS caching and throttler. Sessions vs JWT, OAuth 2.1/OIDC, BFF, Keycloak vs lighter IdPs vs cognito-local, better-auth / Passport / openid-client, argon2id (OWASP params). OWASP Top 10 (2025?) and API Security Top 10 (2023). OpenTelemetry JS status, grafana/otel-lgtm (RAM), Jaeger v2, Prometheus 3, pino / nestjs-pino.
- **D. Claude, Docker, CI, sandbox, dev workflow:** Claude Code headless flags (`-p`, `--output-format json`, JSON schema output if any, `--allowedTools` / `--disallowedTools` / `--tools`, `--permission-mode`, `--add-dir`, `--max-turns`, `--model`), subscription auth for headless use and Pro limits/ToS, the Agent SDK with subscription auth. Anthropic API models, pricing, structured outputs and SDK (optional provider). Docker Desktop vs OrbStack vs Colima (license, RAM, VirtioFS). Sandbox hardening flags, dockerode vs the docker CLI, `internal: true` networks. GitHub Actions and `act` (incl. `--container-architecture` on Apple Silicon), Forgejo/Dagger as alternatives. NestJS hot reload/debugging, Compose `profiles`, `docker compose watch`.
- **E. Industry check and spaced repetition:** 2025–2026 Node/TS backend job postings and surveys (Stack Overflow 2025, State of JS/Node) to confirm or adjust the curriculum. FSRS vs SM-2, ts-fsrs (version, license, maintenance), a Postgres schema for review logs, and Anki card types (basic, reversed, cloze) for technical concepts.

## 5. Original brief from the user (verbatim, draft v0; apply section 2 on top)

> # Role and goal
>
> You are a senior backend/platform engineer and technical curriculum designer. Help me build a **local-first self-study platform** that teaches me backend engineering end to end, from writing APIs to system design, pipelines and infrastructure.
>
> This session has two phases. **Do Phase 1 only, then stop and wait for my approval.**
>
> - **Phase 1 (now): Research and data gathering.** Find out what is current and widely used today for each part of the stack and platform below. Verify everything with web searches; do not rely on memory, since versions and tooling change fast. Then propose updates to the technical doc at the end of this prompt.
> - **Phase 2 (later, after I approve): Build.** Scaffold the platform based on the approved decisions.
>
> ---
>
> # About me (the learner)
>
> - Frontend developer, strong in React and TypeScript.
> - Backend/DevOps level: **some basics**. I've built a simple Node API, know basic SQL, and have used Docker a little.
> - Time budget: **~10 hours per week**.
> - Machine: **macOS** (assume Apple Silicon unless research shows that doesn't matter).
> - Core stack I want to learn: **Node.js, NestJS, TypeScript, PostgreSQL, AWS services (emulated), S3, Stripe**.
> - Additional topics: **Redis, caching and queues; auth and security; IaC and CI/CD; observability and testing**.
> - I also want **spaced repetition** built in, so I retain terms and "how it works" knowledge between sessions.
>
> # Hard constraints
>
> 1. **Everything runs locally** with one command (e.g. `docker compose up` plus a single `make`/`pnpm` script), and **all data persists locally** (Docker volumes or local files) across restarts.
> 2. **No cloud accounts needed for learning.** AWS services must be emulated locally. The goal is to understand how they work and fit together, not to deploy to real AWS.
> 3. **Exception: Stripe.** A free Stripe test-mode account is acceptable, using the real test API and Stripe CLI for webhooks.
> 4. Anything else that would require an account (Docker Desktop licensing, GitHub, AWS emulators, observability tools) must be **flagged explicitly**, with a no-account alternative where one exists.
> 5. Secrets (Anthropic API key, Stripe test keys) live in a local `.env` that is git-ignored and never logged.
>
> ---
>
> # Phase 1: What to research
>
> For each area: list the realistic current options, check current stable versions, maintenance status, licensing and account requirements, macOS/Apple Silicon support, and how commonly each is used in 2026. Then recommend one option.
>
> 1. **Runtime and language:** current Node.js LTS, TypeScript version, package manager (pnpm/npm/bun), monorepo tooling (pnpm workspaces, Turborepo, Nx).
> 2. **Backend framework:** current NestJS major version and its recommended patterns (modules, DI, config, validation, Fastify vs Express adapter).
> 3. **Frontend for the platform UI:** React + Vite (or a better current option), routing, data fetching (e.g. TanStack Query), UI kit, charting library for stats.
> 4. **Database layer:** PostgreSQL version; ORM/query builder comparison (Prisma, Drizzle, TypeORM, MikroORM, Kysely) for *learning value* and for industry usage; migration tooling.
> 5. **AWS emulation (important):** LocalStack changed in March 2026. Its current distribution requires an account and auth token, and the community repo was archived. Compare the no-account alternatives:
>    - Floci
>    - LocalEmu (fork of LocalStack Community)
>    - Moto in server mode
>    - Single-service emulators: MinIO (S3), ElasticMQ (SQS), DynamoDB Local
>    - Pinning the last auth-free LocalStack image (and its risks)
>
>    Evaluate maturity, maintenance activity, and coverage of the services I need: **S3, SQS, SNS, Lambda, IAM, DynamoDB, Secrets Manager/SSM, CloudWatch Logs, EventBridge**. Also check compatibility with the AWS SDK for JavaScript v3, the AWS CLI, and Terraform/OpenTofu.
> 6. **Stripe:** current API version, test mode vs sandboxes, Stripe CLI webhook forwarding, test clocks for subscriptions, and the official Node SDK.
> 7. **Redis and queues:** Redis vs Valkey (licensing), BullMQ status, caching patterns in NestJS, rate limiting.
> 8. **Auth and security:** current recommendations for sessions vs JWT, OAuth/OIDC (with a local identity provider such as Keycloak or an emulated Cognito, no accounts), password hashing (argon2/bcrypt), and the current OWASP Top 10 / API Security Top 10.
> 9. **Testing:** Jest vs Vitest with NestJS, Supertest, Testcontainers for Node, and the current state of e2e testing for APIs.
> 10. **Observability:** OpenTelemetry for Node, and a local all-in-one stack (e.g. Grafana LGTM docker image, Jaeger, Prometheus) that needs no account. Structured logging (pino).
> 11. **CI/CD:** GitHub Actions and running workflows locally (e.g. `act`). Note what requires a GitHub account and what works fully offline.
> 12. **IaC:** Terraform vs OpenTofu vs AWS CDK (with cdklocal or equivalent). Cover licensing and how well each works against the chosen AWS emulator.
> 13. **Docker runtime on macOS:** Docker Desktop (licensing) vs OrbStack vs Colima.
> 14. **Claude-based verification (two providers, both supported):**
>     - **Claude Code CLI in headless mode:** current flags for non-interactive runs, JSON output, schema-constrained output if available, restricting tools to read-only, setting the working directory, and how auth via my Claude subscription works.
>     - **Anthropic API:** current recommended models for code review, structured outputs / tool use for JSON results, the official TypeScript SDK, and a rough cost estimate per verification run.
> 15. **Sandboxing learner code:** a safe way to run my submitted code and the task test suites (ephemeral Docker containers, resource limits, no network except to the local stack).
> 16. **Industry check:** what Node/TypeScript backend job postings and recent surveys (e.g. Stack Overflow, State of JS/Node) list most often in 2026. Use this to confirm or adjust the curriculum.
> 17. **Spaced repetition:** compare scheduling algorithms (FSRS vs SM-2) and current TypeScript implementations (e.g. ts-fsrs): maintenance status, license, and how to store review history in Postgres. Look at how Anki and similar tools structure cards (basic, reversed, cloze) and which card types work best for technical concepts.
> 18. **Local dev workflow:** which services run in Docker vs natively on macOS, bind-mount performance, hot reload, debugging NestJS from the editor, and how the Claude Code CLI provider can be called from the worker (likely host-only).
>
> # Phase 1 output format
>
> 1. **Stack Decision Record:** a table with columns *Area | Options considered | Recommendation | Version | Why | Risks/caveats | Account needed?*
> 2. **Changes to the technical doc:** concrete edits to the draft below, with reasons.
> 3. **Revised curriculum:** module list with week estimates at 10 h/week.
> 4. **Open questions for me:** at most 5, only ones that change the build.
> 5. **Sources:** links for every version number and every non-obvious claim.
>
> Then **stop**. Do not scaffold or write code until I approve.
>
> ---
>
> # Technical doc (draft v0; revise it in Phase 1)
>
> ## 1. Vision
> A local web platform that gives me:
> - a structured backend learning plan
> - lessons
> - hands-on tasks with automated and AI-assisted verification
> - spaced repetition for long-term retention
> - statistics on my progress
>
> The platform is itself built with the stack I'm learning (React + NestJS + Postgres), so reading and extending its code is part of the practice.
>
> ## 2. Architecture (proposed)
> - **Monorepo:**
>   - `apps/web`: React UI
>   - `apps/api`: NestJS API
>   - `apps/worker`: verification and background jobs (queue consumer)
>   - `packages/shared`: shared types and schemas, e.g. zod
>   - `curriculum/`: modules, lessons, tasks and lesson card decks as versioned markdown + YAML/JSON
>   - `infra/`: docker compose, Dockerfiles, IaC
> - **Local services (Docker Compose, persistent volumes):**
>   - PostgreSQL (platform data)
>   - Redis/Valkey (queues, cache)
>   - AWS emulator (chosen in Phase 1)
>   - Observability stack
>   - Stripe CLI (webhook forwarding)
>   - A separate "lab" Postgres/Redis for task exercises, so experiments never touch platform data
> - **Run modes:**
>   - **Dev mode (default):** infrastructure services run in Docker Compose; `apps/api`, `apps/worker` and `apps/web` run natively on macOS with hot reload and editor debugging.
>   - **Full mode:** everything, including the apps, runs in Docker from production-style multi-stage Dockerfiles; used for the CI/CD and system-design modules.
>   - The Claude CLI provider runs on the host, since it depends on my local Claude Code login.
> - **Learner workspace:** a separate local git repo, my "lab project", where I solve tasks. Submissions reference this repo by path + commit SHA.
>
> ## 3. Core domain model
> - **Curriculum:** Track → Module → Lesson → Task
> - **Submission:** what I send for a task (repo + commit SHA, text answer, or diagram)
> - **VerificationRun:** stages, results, logs, provider, model, cost
> - **RubricScore:** score per skill per run
> - **Skill:** tags like "sql-indexes" or "idempotency", shared by tasks, cards and stats
> - **StudySession:** time tracking
> - **PlanItem:** scheduled work
> - **Card:** type, front, back, source (manual / lesson / Claude-suggested), skill tags, lesson link, status (pending approval / active / suspended)
> - **CardSchedule:** algorithm state (stability, difficulty, due date)
> - **Review:** card, grade, timestamp, time to answer, mode (self-graded / Claude-graded)
> - **Settings:** verification provider, weekly hour budget, new cards per day, review cap
>
> ## 4. Curriculum (initial outline at ~10 h/week; to be validated)
> 0. Foundations: HTTP in depth, Node runtime and event loop, TypeScript for the backend, Docker and compose (1 wk)
> 1. NestJS fundamentals: modules, DI, controllers, pipes, validation, config, error handling (2 wk)
> 2. PostgreSQL and data modeling: SQL, normalization, indexes, EXPLAIN, transactions, isolation levels, migrations, ORM (3 wk)
> 3. Testing: unit, integration with Testcontainers, e2e; testing taught throughout and practiced here (1 wk + ongoing)
> 4. Auth and security: sessions/JWT, OAuth/OIDC, RBAC, hashing, OWASP basics (2 wk)
> 5. Redis, caching, queues: cache strategies, invalidation, BullMQ, retries, rate limiting (2 wk)
> 6. File storage with S3 (emulated): buckets, presigned URLs, multipart upload, lifecycle (1 wk)
> 7. Payments with Stripe: Checkout, subscriptions, webhooks, signature verification, idempotency, reconciliation (2 wk)
> 8. AWS concepts (emulated): IAM, SQS/SNS, EventBridge, Lambda, DynamoDB, Secrets Manager; event-driven patterns (2 wk)
> 9. Observability: structured logs, metrics, traces, dashboards, alerting concepts (1 wk)
> 10. CI/CD: Dockerfiles, GitHub Actions pipelines (lint, test, build, migrate), running locally (1 wk)
> 11. Infrastructure as Code: provision the emulated AWS resources with the chosen IaC tool; environments and state (2 wk)
> 12. System design and capstone: design reviews (scaling, consistency, failure modes), then a capstone such as a SaaS with auth, uploads to S3, Stripe subscriptions, background jobs, observability, CI and IaC (4 wk)
>
> Every lesson ships with a curated card deck for spaced repetition.
>
> ## 5. Tasks and verification (hybrid)
> Each task has a spec, starter hints, acceptance criteria, a hidden automated check suite, and a review rubric.
>
> **Stage 1: automated checks (always run first, deterministic).** The worker runs the task's check suite in an ephemeral sandbox container against my lab repo at the submitted commit. Depending on the task, checks can include:
> - HTTP probes (Supertest-style)
> - SQL assertions against the lab DB (schema, indexes, query plans)
> - Emulator state checks (bucket exists, queue has messages, IAM policy is correct)
> - Stripe test-mode event checks
> - Lint, type check, and test pass/fail
>
> Output: pass/fail per criterion with logs.
>
> **Stage 2: Claude review (runs after stage 1; or alone for design/written answers).** Claude reviews the diff, the stage 1 results and the rubric. It returns strict JSON with:
> - a score per rubric item
> - strengths and issues, each with file/line
> - security concerns
> - a suggested next step
> - suggested memory cards based on my mistakes
>
> It must not rewrite my solution. Two interchangeable providers behind one interface, selectable in Settings:
> - **ClaudeCliProvider:** runs Claude Code headless with read-only tools, scoped to the submission directory.
> - **AnthropicApiProvider:** calls the Messages API with structured output.
>
> The JSON result is validated against a schema; invalid output triggers one retry, then falls back to stage 1 results only. Every run stores the prompt, provider, model, raw output, duration and (for the API) token cost.
>
> **Submission types:** git repo + commit SHA (code tasks); text/markdown answer (design questions, written explanations); diagram upload (system design, stored in the S3 emulator).
>
> ## 6. Spaced repetition (memory)
> Goal: retain terms, concepts and "how it works" knowledge between study sessions.
>
> **Card types**
> - **Term:** e.g. "idempotency key" → definition + example.
> - **Concept / how it works:** e.g. "What happens when a Stripe webhook is delivered twice?" → explanation.
> - **Cloze:** fill-in-the-blank on a sentence or code snippet.
> - **Comparison:** e.g. "SQS vs SNS", "JWT vs session".
> - **Command/snippet:** e.g. "Create a presigned S3 upload URL with AWS SDK v3".
>
> **Where cards come from**
> 1. **Manual:** a "Save to memory" action on any highlighted text in a lesson, plus a quick-add form.
> 2. **Lesson decks:** each lesson ships with curated cards in the curriculum files.
> 3. **Claude-suggested:** after a lesson or a verification run, Claude proposes cards from the key concepts and from my mistakes (e.g. a missing index → a card on composite index ordering). I approve or edit each card before it enters my deck; nothing is added automatically.
>
> **Scheduling:** FSRS (or the algorithm chosen in Phase 1) with 4 grades: Again / Hard / Good / Easy. Every review is stored in Postgres, so the schedule can be recalculated if the algorithm or its parameters change.
>
> **Review modes**
> - **Daily review queue:** due cards first, with a configurable cap on new cards per day.
> - **Optional free-recall mode:** I type the answer and Claude grades it against the reference answer. It suggests a grade; I can override it.
>
> **Integration with the plan:** daily review time (~10–15 min) counts toward the 10 h/week budget. Cards are tagged with skills, so weak recall on a skill can trigger a review task.
>
> ## 7. Plan and statistics
> - **Plan:** auto-generated week-by-week schedule from the curriculum and my 10 h/week budget, including daily review time. It adapts when I fall behind or move ahead, and flags weak skills for review tasks and extra cards.
> - **Learning statistics:**
>   - Hours logged vs planned
>   - Tasks completed
>   - First-attempt pass rate
>   - Average attempts per task
>   - Rubric scores per skill over time (radar/trend)
>   - Streaks
>   - Module completion and projected finish date
>   - Verification cost (API provider)
> - **Memory statistics:**
>   - Cards due today
>   - Review streak
>   - Retention rate (share of reviews answered correctly)
>   - Mature vs learning cards
>   - Skills with the weakest recall
>
> ## 8. Non-goals
> - Multi-user support, hosting, or real cloud deployment
> - Video content
> - Being a general-purpose LMS
>
> ## 9. Definition of done for the MVP (Phase 2)
> - One command starts all infrastructure; data survives a restart.
> - Dev mode (native apps + Docker services) and full mode (everything in Docker) both work.
> - Curriculum modules 0–2 fully authored, with at least 3 verifiable tasks and a card deck per lesson.
> - Both verification providers work end to end on at least one task.
> - Spaced repetition works end to end: create a card manually, approve a Claude-suggested card, review it, and see it rescheduled.
> - Plan view and stats dashboard show real data from my submissions and reviews.
> - README covers setup on macOS, both run modes, and how to add new tasks and cards.
