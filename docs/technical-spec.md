# Technical spec v1: backend self-study platform

Status: 2026-11-18. This replaces draft v0 (kept verbatim in [`HANDOFF.md`](./HANDOFF.md), section 5). Tool choices and versions are in [`stack-decisions.md`](./stack-decisions.md). The reasoning behind each choice is in [`decisions.md`](./decisions.md).

## 1. Vision

A local web platform for one learner that provides:

- a recommended learning order with progress, and no schedule
- lessons written for every module
- hands-on tasks with automated checks and a Claude review
- spaced repetition for long-term retention
- statistics on time actually spent, task results and recall

The platform is built with the stack it teaches (React, NestJS, PostgreSQL), so reading and extending it is part of the practice.

## 2. Changes from draft v0

| # | Draft v0 | v1 | Reason |
|---|---|---|---|
| 1 | Week-by-week plan at 10 h/week, projected finish date, hours logged vs planned | Recommended order, S/M/L effort per module, time actually spent | Self-paced (handoff) |
| 2 | 13 modules | 18 modules (0–17), each marked core or optional | Missing topics, industry check |
| 3 | Platform and lab share the AWS emulator | Platform stores files on local disk; the lab has its own emulator | A lab exercise could destroy platform data |
| 4 | Redis/Valkey in the core stack | Core is web + API + worker + one Postgres; jobs use pg-boss | Low-RAM machines |
| 5 | Worker launches sandboxes and calls the Claude CLI | A native host bridge is the only process that does either | Full mode runs the worker in Docker; the socket must stay out of it |
| 6 | Two providers: Claude CLI and Anthropic API | Two modes: "Copy for Claude" and one-click through the bridge. API provider is an interface slot | Pro plan, no API key |
| 7 | Lab repo with unspecified layout | One lab repo, one folder per task: `lab/m02-postgres/t03-indexes/` | Self-contained tasks, simple mounts |
| 8 | Diagram uploads stored in the S3 emulator | Stored on local disk under `data/uploads` | Follows from change 3 |
| 9 | "Retention rate (share of reviews answered correctly)" | Share of reviews on cards in the Review state that were not graded Again | Standard FSRS definition |
| 10 | "Weak recall on a skill can trigger a review task" | Defined trigger, see section 7 | Was not measurable |
| 11 | MVP: modules 0–2 authored | All modules authored, in batches | Handoff |
| 12 | Jest implied | Vitest | NestJS 12 default for ESM projects |
| 13 | Observability stack and IdP in the default Compose file | Opt-in profiles | About 2 GB and 0.5 GB of RAM |

## 3. Architecture

### 3.1 Repository layout

```
apps/
  web/        React SPA (Vite)
  api/        NestJS HTTP API
  worker/     NestJS standalone app: pg-boss consumers (verification, card suggestions)
  bridge/     Native host process: runs sandboxes and the Claude CLI
packages/
  shared/     zod schemas and types shared by all apps
  db/         Drizzle schema, migrations, seed
  curriculum-loader/   Parses and validates curriculum files
  lab-cli/    `pnpm lab ...` commands
curriculum/   Modules, lessons, tasks and card decks (Markdown + YAML)
infra/
  compose/    Compose files and profiles
  docker/     Dockerfiles (apps, sandbox runner images)
docs/
```

### 3.2 Processes and who may talk to whom

```
Browser ──HTTP──> api ──SQL──> platform Postgres <──SQL── worker
                   │                                        │
                   └── enqueue (pg-boss, in Postgres) ──────┘
                                                            │ HTTP, localhost only, shared secret
                                                            v
                                                          bridge (native, macOS)
                                                           ├── docker run … sandbox ──> lab-net only
                                                           └── claude -p … (read-only tools)
```

Rules:

- Only the bridge has the Docker socket and the Claude login.
- The worker reaches the bridge at `host.docker.internal` in full mode and `localhost` in dev mode. The bridge binds to `127.0.0.1`, checks a shared secret from `.env`, and accepts only two operations: run a check suite for a task at a commit, and run a Claude review for a prompt.
- Sandboxes join `lab-net` only. That network is `internal: true`, so there is no internet and no route to the platform database.
- If the bridge is not running, the platform still works: lessons, flashcards, text answers and copy-paste review need nothing from it.

### 3.3 Resource tiers

| Tier | Started by | Services | Target RAM |
|---|---|---|---|
| Core | `pnpm dev` | platform Postgres, plus api, worker and web (native in dev mode) | about 1 GB |
| Practice add-ons | `pnpm lab up <service…>` | lab Postgres, lab Valkey, lab AWS emulator, Stripe CLI | small, per service |
| Heavy extras | `pnpm lab up observability`, `pnpm lab up idp`, `pnpm lab up lambda` | `grafana/otel-lgtm`, Keycloak, emulator with Docker socket | 0.5–2 GB each |

Each module's `module.yaml` lists the services its tasks need. The UI shows which are running and the command to start the rest. Without them a module still works as reading plus flashcards.

### 3.4 Run modes

- **Dev mode (default):** Postgres in Compose; api, worker, web and bridge run natively with hot reload.
- **Full mode:** api, worker and web run in Docker from multi-stage Dockerfiles. The bridge still runs natively. Used by the Docker, CI/CD and system-design modules.

### 3.5 Lab workspace

One git repository, created by `pnpm lab init <path>`, with a folder per module and task. A code submission is `{ taskId, folder, commitSha }`. The bridge exports that folder at that commit with `git archive` into a temporary directory and mounts it read-only, so uncommitted work and other tasks are invisible to the checks.

### 3.6 Sandbox container

```
docker run --rm \
  --network lab-net \
  --memory 512m --cpus 1 --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges \
  --read-only --tmpfs /work:rw,size=256m --tmpfs /tmp \
  --user 10001:10001 \
  -v <export>:/submission:ro -v <checks>:/checks:ro \
  <runner image> <check command>
```

A hard timeout (default 120 s) kills the container. Limits can be raised per task in `task.yaml`. The threat model is accidents, not hostile code.

## 4. Domain model

Changes from v0: `PlanItem` loses its schedule, `Settings` loses the weekly budget, and four entities are added.

- **Module, Lesson, Task:** loaded from `curriculum/` at start-up and upserted by stable slug. Content stays in files; the database holds ids, order, core/optional and effort.
- **Skill:** tag such as `sql-indexes`, shared by tasks, cards and stats.
- **LessonProgress:** lesson, status (not started / in progress / done), timestamps. *New.*
- **Submission:** task, type (repo / text / diagram), folder and commit SHA, or text, or file reference.
- **VerificationRun:** submission, stage (checks / review), status, mode (copy-paste / bridge / api), model, prompt, raw output, parsed result, duration, cost if known.
- **CheckResult:** run, criterion id, pass or fail, log excerpt. *New; was implicit.*
- **RubricScore:** run, rubric item, skill, score.
- **Card:** type, front, back, source (manual / lesson / Claude-suggested), skills, lesson link, status (pending approval / active / suspended).
- **CardSchedule:** FSRS state for a card: stability, difficulty, due, state, reps, lapses, last review.
- **Review:** card, grade, timestamp, answer time, mode (self-graded / Claude-graded), plus the FSRS log fields needed to replay.
- **StudySession:** start, end, activity (lesson / task / review), linked item. Time actually spent.
- **ReviewTask:** skill, reason, status. Created by the weak-recall trigger. *New.*
- **LabService:** name, profile, last known state. *New.*
- **Settings:** review mode, new cards per day, review cap, desired retention, lab repo path.

## 5. Curriculum

No week estimates. Effort is relative: S is roughly a third of M, L roughly double M. Modules are listed in recommended order, and optional ones can be skipped without breaking later tasks.

| # | Module | Kind | Effort | Practice services |
|---|---|---|---|---|
| 0 | Foundations: HTTP in depth, Node runtime and event loop, TypeScript for the backend | Core | M | none |
| 1 | Docker and Compose: images, layers, networks, volumes, multi-stage builds | Core | S | none |
| 2 | NestJS fundamentals: modules, DI, controllers, pipes, validation (class-validator and zod), config, errors | Core | M | none |
| 3 | PostgreSQL and data modelling: SQL, normalisation, indexes, EXPLAIN, transactions, isolation, migrations, raw SQL then Drizzle, Prisma comparison | Core | L | lab Postgres |
| 4 | API design: REST conventions, OpenAPI, pagination, versioning, error formats (RFC 9457), idempotency keys; GraphQL and gRPC compared | Core | M | lab Postgres |
| 5 | Testing: unit, integration with Testcontainers, API end-to-end, test doubles | Core | M | lab Postgres |
| 6 | Auth and security: sessions, JWT, RBAC, argon2id, OWASP Top 10:2025, API Top 10; OAuth 2.1 and OIDC with a local IdP | Core (OIDC part optional) | L | lab Postgres; Keycloak for OIDC |
| 7 | Caching and queues: cache strategies and invalidation, BullMQ, retries, rate limiting | Core | M | lab Valkey |
| 8 | Reliability patterns: timeouts, retries with backoff, idempotency, outbox, sagas, optimistic and pessimistic concurrency | Core | M | lab Postgres, lab Valkey |
| 9 | File storage with S3: buckets, presigned URLs, multipart upload, lifecycle | Core | S | lab AWS emulator |
| 10 | Payments with Stripe: Checkout, subscriptions, webhooks and signatures, idempotency, test clocks, reconciliation | Core | M | Stripe CLI, lab Postgres |
| 11 | AWS building blocks: IAM, SQS and SNS, EventBridge, DynamoDB, Secrets Manager and SSM, Lambda | Core (Lambda optional) | L | lab AWS emulator; `lambda` profile |
| 12 | Observability: structured logs, metrics, traces, dashboards, alerting concepts | Core | M | observability stack |
| 13 | CI/CD: pipelines for lint, typecheck, test, build and images; running workflows locally with `act` | Core | S | none |
| 14 | Infrastructure as code: OpenTofu against the emulator, state, environments | Core | M | lab AWS emulator |
| 15 | Kubernetes: what it solves, pods, deployments, services, config and secrets, probes, scaling, and when it is and is not worth using | Core, theory | M | none (optional self-practice with `kind`) |
| 16 | Kafka and event streaming: logs vs queues, topics, partitions, consumer groups, delivery guarantees, and where it fits next to SQS and BullMQ | Core, theory | S | none (optional self-practice) |
| 17 | System design and capstone: design reviews, then a SaaS with auth, uploads, subscriptions, jobs, observability, CI and IaC | Core | L | most of the above |

Modules 15 and 16 are theory modules: lessons, card decks and written tasks (design questions reviewed by Claude), with no practice environment in Docker. Each ends with a short "practise on your own" section for learners who want hands-on time later.

Every lesson ships with a card deck. Testing is introduced in module 5 and then required in the checks of every later code task.

### 5.1 File format

```
curriculum/
  m03-postgres/
    module.yaml            # title, kind, effort, skills, services
    l02-indexes/
      lesson.md            # the lesson, with links to official docs
      cards.yaml           # curated deck
    t03-indexes/
      task.yaml            # spec, hints, acceptance criteria, rubric, limits, services
      checks/              # hidden check suite, mounted read-only into the sandbox
      starter/             # copied into the lab repo by `pnpm lab start`
```

All files are validated with zod when the API starts. A broken file fails loudly with its path and the field at fault.

## 6. Tasks and verification

### Stage 1: automated checks

Runs first and is deterministic. The worker asks the bridge to run the task's check suite in a sandbox against the submitted commit. Checks can be HTTP probes, SQL assertions against the lab database (schema, indexes, query plans), emulator state checks, Stripe sandbox event checks, and lint, type and test results. Output is pass or fail per criterion with logs.

Without the bridge, a code task can still be submitted. Stage 1 is then marked "not run" and the review prompt says so.

### Stage 2: Claude review

Runs after stage 1, or alone for design and written answers. Claude gets the task spec, the rubric, the diff, the stage 1 results and a JSON schema. It returns a score per rubric item, strengths and issues with file and line, security concerns, a suggested next step, and suggested memory cards. It must not rewrite the solution.

One interface, three implementations:

| Mode | How it runs | Status |
|---|---|---|
| Copy for Claude | The platform builds the prompt. The learner pastes it into claude.ai or Claude Code and pastes the JSON reply back. | Default |
| One-click | The bridge runs `claude -p --output-format json --json-schema …` with read-only tools in the exported task folder, using the learner's Claude plan. | Opt-in, needs the bridge and a local Claude login |
| Anthropic API | Messages API with structured output. | Interface only, not built |

The reply is validated with zod. Invalid output from one-click triggers one retry, then falls back to stage 1 results only. Invalid pasted output shows the validation errors so the learner can ask Claude to fix it. Every run stores the prompt, mode, model, raw output and duration.

### Submission types

- Git folder and commit SHA for code tasks.
- Markdown text for design questions and written explanations.
- Diagram upload (PNG, SVG or PDF) for system design, stored on local disk. Reviewed through copy-paste, where the learner attaches the image.

## 7. Spaced repetition

**Card types:** term, concept ("how it works"), cloze, comparison, command or snippet.

**Sources:** manual (highlight text in a lesson and save it, or a quick-add form), lesson decks from `cards.yaml`, and Claude-suggested cards from a review. Suggested cards wait in a "pending approval" list. Nothing enters the deck without approval.

**Scheduling:** FSRS through `ts-fsrs`, four grades (Again, Hard, Good, Easy), default parameters, desired retention 0.9 (configurable). Every review is stored with enough fields to replay it, so schedules can be rebuilt if the algorithm version or parameters change.

**Review modes:** a daily queue (due cards first, capped number of new cards), and free recall where the learner types an answer and Claude suggests a grade. Free recall is offered only when one-click review is enabled.

**Definitions:**

- *Retention rate:* over a period, reviews of cards in the Review state that were not graded Again, divided by all reviews of cards in the Review state. Learning and relearning steps are excluded, as in Anki's "true retention".
- *Weak skill:* a skill with at least 10 qualifying reviews in the last 30 days and a retention rate below the desired retention minus 10 points.
- *Review task trigger:* when a skill becomes weak and has no open review task, the platform creates one that links the relevant lesson and the skill's most-lapsed cards. It closes when the skill's retention recovers or the learner dismisses it.

## 8. Plan and statistics

- **Plan:** modules in recommended order with status, core or optional, effort, and the services each needs. A "next up" list: the next unfinished lesson, open tasks, due cards, and open review tasks. No dates.
- **Learning statistics:** time actually spent (per day, per module, per activity), tasks completed, first-attempt pass rate, average attempts per task, rubric scores per skill over time, streaks, module completion.
- **Memory statistics:** cards due today, review streak, retention rate, cards by state (new, learning, young, mature), weakest skills.

## 9. Non-goals

- Multi-user support, hosting or real cloud deployment.
- Video content.
- A general-purpose LMS.
- Protection against hostile submitted code.

## 10. Definition of done for the MVP

- One command starts the core tier, and data survives a restart.
- Dev mode and full mode both work.
- All modules are authored, each lesson with a card deck, and at least three verifiable tasks per core module.
- Copy-paste review works end to end on a code task and a text task. One-click review works on a code task.
- The sandbox runs a check suite with the limits in section 3.6 and cannot reach the platform database.
- Spaced repetition works end to end: create a card manually, approve a suggested card, review it, see it rescheduled.
- Plan and stats show real data.
- `pnpm lab up/down/status` manages practice services.
- GitHub Actions runs lint, typecheck, test and build for the platform repo.
- README covers macOS setup, both run modes, the bridge, and how to add tasks and cards.

## 11. Open questions

None of these block the build. Each has a default that is recorded in the decision log.

1. **One-click review needs a test on your Mac.** I cannot verify from here that `claude -p`, started by a background Node process, can read your Claude login from the macOS Keychain. Default: build it, and you try it once.
2. **Stripe account.** A persistent sandbox needs a free Stripe signup. Default: lessons assume you create one when you reach module 10.
3. ~~Kubernetes and Kafka optional or core?~~ Resolved 2026-11-18: both are core, taught as theory with practical guidance on where to use them, and no Docker practice environment.
4. **Prisma vs Drizzle.** Drizzle is the platform's ORM and the main one taught. Default: Prisma gets one comparison lesson and one task.
5. **Repository default branch.** The repo has no `main`. Default: I keep working on the thread branch and open a pull request when step 1 of the build runs.
