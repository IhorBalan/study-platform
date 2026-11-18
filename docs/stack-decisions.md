# Stack Decision Record

Research date: 2026-11-18. Versions marked **npm** were read directly from the npm registry on that date. Everything else links to a source in the last section. Items I could not confirm from a primary source are marked *unverified* and listed under "Known gaps".

The reasoning and the alternatives behind each row live in [`decisions.md`](./decisions.md), which is the log to review and revisit.

## 1. Decision table

| Area | Options considered | Recommendation | Version | Why | Risks / caveats | Account needed? |
|---|---|---|---|---|---|---|
| Runtime | Node 22, 24, 26 | **Node 26 LTS** (minimum 24) | 26.13.x | 26 entered LTS in October 2026 and is supported to April 2029. `ts-fsrs` 6 requires Node ≥ 24. [S1] | Node moves to one major per year from 27. | No |
| Language | TypeScript 6.0, 7.0 | **TypeScript 7.0** | 7.0.2 (npm) | The Go compiler is GA since 2026-07-08 and 8–12x faster. I tested 7.0.2 locally: `experimentalDecorators` + `emitDecoratorMetadata` still emit `design:paramtypes`, which NestJS DI needs. [S2] | 7.0 has no stable programmatic API yet, so `typescript-eslint` stays on 6. That drives the lint choice below. `baseUrl` and `moduleResolution: node` are hard errors. | No |
| Package manager | npm, pnpm 11, pnpm 12, bun | **pnpm 11** | 11.28.12 (npm `latest-11`) | Workspaces, catalogs, and a one-day release cooldown on by default (supply-chain lesson for free). [S3] | pnpm 12 is already `latest` on npm (12.21.0). I found no release notes for it, so I stay one major back. | No |
| Monorepo | pnpm workspaces alone, Turborepo, Nx | **pnpm workspaces + Turborepo** | turbo 2.11.x (npm) | Task caching and ordering with almost no config. Nx is heavier than a three-app repo needs. | None significant. | No (remote cache is optional and off) |
| Backend framework | NestJS 11, 12 | **NestJS 12, ESM project** | 12.5.1 (npm) | Current major. Core is ESM, ESM projects default to Vitest, route decorators accept Standard Schema (zod), official `@nestjs/observe` tracing. [S4] | Young major (October 2026). `@nestjs/schematics` needs TypeScript ≥ 6. | No |
| HTTP adapter | Express 5, Fastify 5 | **Express 5** (Nest default) | 5.3.0 (npm) | Express still leads usage in State of JS 2025, and most NestJS material assumes it. Fastify gets a comparison lesson. [S15] | Slower than Fastify; irrelevant locally. | No |
| Validation | class-validator, zod via Standard Schema | **zod 4** for the platform, class-validator taught in a lesson | zod 4.6.x (npm) | One schema shared by API, worker, bridge and web. Nest 12 supports it natively. class-validator is still "the documented default" in Nest, so the learner must know it. [S4] | Two styles to learn. | No |
| ORM / query layer | Prisma, Drizzle, Kysely, TypeORM, MikroORM | **Drizzle** for the platform. Curriculum: raw SQL first, then Drizzle, then a Prisma comparison | drizzle-orm 0.45.4, drizzle-kit 0.31.11 (npm) | Closest to SQL, so the learner sees the queries. Prisma has the most downloads and gets its own lesson. [S5] | Drizzle 1.0 is still RC (rc.5, 2026-10-21) with breaking relational-query changes. Mitigation: use the SQL-like builder, not the relational query API. Prisma's npm `latest` tag currently points at `8.0.0-rc.34`, with 7.10.1 under `prev`. | No |
| Database | PostgreSQL 17, 18, 19 | **PostgreSQL 18** | 18.7 | Current stable. 19 GA is planned for 2026-11-19. [S6] | Move to 19 after its first minor release. | No |
| Platform job queue | BullMQ + Valkey, pg-boss, graphile-worker | **pg-boss** | 12.38.2 (npm) | Keeps the core tier to one Postgres. Retries with backoff, dead-letter queues, cron, pub/sub. [S7] | Single maintainer. Needs Node ≥ 22.12 and Postgres ≥ 13. | No |
| Frontend | React + Vite, Next.js | **React 19 + Vite 8** | react 19.3.1, vite 8.3.x (npm) | A local SPA needs no server rendering. Vite 8 uses Rolldown and Oxc. [S8] | None significant. | No |
| Routing / data | React Router 8, TanStack Router | **TanStack Router + TanStack Query** | router 1.170.x, query 5.108.x (npm) | Fully typed routes and search params fit a TypeScript-strong learner. | React Router is more common in job posts. | No |
| UI / charts / content | shadcn/ui, MUI, Mantine; Recharts, visx | **Tailwind 4 + shadcn/ui, Recharts 3, Markdown + Shiki** | tailwind 4.3.x, recharts 3.11, shiki 4.6 (npm) | Owned components, no runtime theme dependency. Recharts covers radar and trend charts. | shadcn/ui is copied code, so updates are manual. | No |
| Lint / format | ESLint + typescript-eslint, Biome, oxlint | **oxlint + Prettier** | oxlint 1.94 (npm) | NestJS 12 generates oxlint projects, and it does not depend on the TypeScript API that 7.0 lacks. [S4] | No type-aware lint rules until TS 7.1 ships its API. | No |
| Testing | Jest, Vitest | **Vitest 5 + Supertest + Testcontainers** | vitest 5.1.1, supertest 7.3, testcontainers 12.2 (npm) | Nest 12 defaults ESM projects to Vitest. Testcontainers gives real Postgres in integration tests. [S4][S9] | Vitest's transformer does not emit decorator metadata, so NestJS tests need `unplugin-swc` (*unverified for Vitest 5; I check it in the first build step*). | No |
| AWS emulation | LocalStack, Floci, LocalEmu, Moto server, single-service emulators, pinned old LocalStack | **Floci**, lab instance only | pin a dated release (2.4.0 or later) | MIT, no token, port 4566, covers all nine required services, about 13 MiB idle, arm64 image, publishes SDK v3 / CLI v2 / Terraform / OpenTofu / CDK compatibility suites. [S10] | Young project (2026), vendor-run benchmarks, IAM enforcement off by default, Lambda needs the Docker socket. Fallback: LocalStack pinned to a pre-2026.03 tag (no patches) or LocalEmu (one maintainer). | No |
| Platform file storage | S3 emulator, MinIO, local disk | **Local disk** (`data/uploads`) behind a storage interface | — | The platform must not share the lab emulator (handoff decision), and MinIO community is archived with no images since October 2025. [S11] | None. | No |
| IaC | Terraform, OpenTofu, CDK, Pulumi | **OpenTofu**, with a note that the HCL is Terraform-compatible | 1.13.2 | MPL-2.0, no account, same language as Terraform (BSL, 1.17.0), in Floci's test matrix. [S12] | Job posts say "Terraform", so lessons name both. | No |
| Payments | Stripe test mode, Stripe sandboxes | **Stripe sandbox** + Stripe CLI | API `2026-10-28.endive`, stripe-node 23.1.0, CLI ≥ 1.43.3 | Stripe recommends general sandboxes for new integrations. The CLI can create an anonymous sandbox with working keys. [S13] | **Free Stripe signup needed for a persistent sandbox.** The anonymous sandbox's lifetime is *unverified*. | Yes (free), as the brief allows |
| Cache / queues (curriculum) | Redis 8, Valkey 8.1, Valkey 9 | **Valkey 8.1 + BullMQ 6** | valkey 8.1, bullmq 6.7.7 (npm) | BSD-3 licence, wire-compatible, and BullMQ's own benchmark calls 8.1 "the sweet spot". [S14] | Redis Stack modules do not run on Valkey. | No |
| Auth (curriculum) | Sessions, JWT; Keycloak, Zitadel, Authentik, Authelia | **Server sessions first, then JWT, then OIDC against Keycloak** (opt-in) | Keycloak 26.8 | BFF with cookies is the top recommendation in RFC 10017 (August 2026). Keycloak is the IdP most likely met at work. [S16] | Keycloak idles at about 540 MiB, so it is a heavy extra. | No |
| Password hashing | bcrypt, argon2id | **argon2id**, m=19456 KiB, t=2, p=1 | argon2 0.45.x (npm) | OWASP minimum configuration. [S16] | Native module build. | No |
| Security references | — | **OWASP Top 10:2025, API Security Top 10 2023** | — | 2025 edition is final. New entries: A03 Software Supply Chain Failures, A10 Mishandling of Exceptional Conditions. [S16] | — | No |
| Observability | OTel + LGTM, Jaeger, Prometheus | **OpenTelemetry JS SDK 3 + pino, `grafana/otel-lgtm`** (opt-in) | OTel SDK 3.0, pino 10.4, nestjs-pino 5.3 | Traces, metrics and logs are all stable in SDK 3.0 (2026-11-05). One container gives Grafana, Tempo, Loki and metrics. [S17] | The image wants about 2 GB, so it is a heavy extra. SDK 3 needs Node ≥ 22.15. | No |
| CI/CD | GitHub Actions, Forgejo, Dagger; `act` | **GitHub Actions** for the platform repo, **`act`** offline | act 0.2.89 | Confirmed with Ihor. Task verification never runs in CI. [S18] | `act` ignores `concurrency`, `permissions` and `environment`, and its default images lack tools. | GitHub: yes. `act`: no |
| Docker runtime | Docker Desktop, OrbStack, Colima | **OrbStack recommended**, any Docker Engine API works | — | Free for personal use, lowest idle RAM in the comparisons I read (about 200–300 MB). Colima is the open-source route. [S19] | OrbStack is closed source and paid for commercial use. RAM figures are third-party. | No sign-in found for any of the three (*unverified*) |
| Claude verification | Copy-paste, `claude -p` headless, Anthropic API | **Copy for Claude** (default) and **one-click through the host bridge**. API provider stays an interface slot. | Claude Code CLI ≥ 2.1.302 | `claude -p --output-format json --json-schema` returns validated JSON in `structured_output`. Signed in with a plan, `claude -p` still draws from subscription limits. [S20] | Anthropic announced and then paused moving `claude -p` to a separate credit; it could return. `--bare` skips subscription login and is slated to become the `-p` default. | Claude Pro (already assumed) |
| Sandbox | dockerode, docker CLI | **Host bridge shells out to the `docker` CLI** | — | The exact flags are visible and teachable: `--network lab-net --memory --cpus --pids-limit --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs --user`. | Only the bridge may start containers. | No |
| Spaced repetition | SM-2, FSRS | **FSRS via `ts-fsrs`** | 6.0.0 (npm, MIT) | FSRS-6 beats SM-2 for 99.6% of users in the 10k-user benchmark. Every review is stored, and `reschedule()` rebuilds state from logs. [S21] | ts-fsrs 6 needs Node ≥ 24 and its docs now default to FSRS-7 with a renamed API. Default parameters are fine until there is enough history to optimise. | No |
| Kubernetes (elective) | kind, k3d, minikube | **kind** | — | Runs on any Docker runtime with no account. | *Not researched in depth; chosen from experience and to be verified when that module is written.* | No |

## 2. What the research changed in the plan

1. **TypeScript 7 is usable with NestJS**, which I verified by compiling a decorator-metadata sample. The cost is linting without type-aware rules for now.
2. **Vitest replaces Jest** as the default, following NestJS 12.
3. **Drizzle 1.0 is not out**, so the platform stays on 0.45 and avoids the API that 1.0 breaks.
4. **Floci is the emulator**, but its Lambda support needs the Docker socket. That conflicts with "only the bridge touches Docker", so Lambda tasks run through a separate opt-in lab profile and the default lab emulator has no socket.
5. **The Pro-plan one-click review is viable today**, but it rests on a billing change Anthropic paused. Copy-paste mode is therefore the default, and it must cover every task type.
6. **The observability stack and Keycloak are confirmed as heavy extras** (about 2 GB and 0.5 GB).
7. **Node 24 is the floor**, set by `ts-fsrs` 6.

## 3. Industry check

Sources: Stack Overflow Developer Survey 2026 (30,903 responses), State of JS 2025, and three job-posting analyses from May–July 2026. [S15]

| Signal | Number | Effect on the curriculum |
|---|---|---|
| PostgreSQL usage | 58% of developers (SO 2026, #1 database); 29–36% of backend postings | The Postgres module stays the largest. |
| AWS | 42–55% of backend postings | Emulated AWS stays core. |
| Docker | 32–48% of backend postings | Docker moves from "Foundations" into its own hands-on thread. |
| Kubernetes | 34–35% of backend postings, 20% of Node postings | **Higher than I expected for an elective.** It stays optional because it is heavy locally, but it is flagged "recommended for a job switch". |
| CI/CD | 37% of backend postings | Core. |
| Microservices | 30–42% of backend postings | Covered in the reliability and system-design modules. |
| Kafka | 21–22% of backend postings | **New optional lesson** on log-based messaging vs queues. Concepts first, hands-on with a single-node Kafka-compatible broker is optional. |
| APIs / REST | 39% / 23% | Confirms the new API design module. GraphQL (9–15%) gets one comparison lesson. |
| Observability / monitoring | 21–22% | Core. |
| Terraform | 8% | IaC stays core but short. |
| Express leads Node framework usage; NestJS "progressing at a nice clip" | no percentages published in the text I could read | NestJS on Express is the right default. |

Caveats: the three job-posting sources use different denominators, and none of them breaks out NestJS or Express. The State of JS percentages were in charts I could not read.

## 4. Known gaps

- Whether Vitest 5 still needs `unplugin-swc` for decorator metadata. I test this in the first build step.
- The exact last LocalStack tag that runs without a token. LocalStack's post only gives "4.12" as an example.
- Floci's latest version number and whether IAM policies are enforced when the strict flag is on.
- Whether OrbStack, Colima or Docker Desktop need a sign-in. None of the pages I read said so.
- Stripe test-clock limits and the lifetime of an anonymous CLI sandbox.
- pnpm 12 release notes.
- Anthropic API cost per verification run: with Sonnet 5.5 at $2 / $10 per million tokens, a review of roughly 20k input and 2k output tokens is about $0.06. The token counts are my estimate.

## 5. Sources

- **[S1] Node.js** — https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule · https://infoq.com/news/2026/06/nodejs-release-changes · https://fireup.pro/news/nodejs-26-lts-whats-new-upgrade
- **[S2] TypeScript** — https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ · https://infoq.com/news/2026/08/typescript-7-released/
- **[S3] pnpm** — https://doolpa.com/news/pnpm-11-released-esm-node-22-supply-chain-defaults-april-28-2026
- **[S4] NestJS** — https://docs.nestjs.com/migration-guide · https://infoq.com/news/2026/10/nestjs-12-observability · https://rspack.rs/guide/tech/nestjs
- **[S5] ORMs** — https://orm.drizzle.team/docs/latest-releases · https://releasebot.io/updates/drizzle · https://encore.dev/articles/drizzle-vs-prisma · https://www.pkgpulse.com/guides/prisma-vs-drizzle-2026
- **[S6] PostgreSQL** — https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/
- **[S7] Queues** — https://github.com/timgit/pg-boss · https://github.com/timgit/pg-boss/releases · https://www.pkgpulse.com/guides/bullmq-vs-bee-queue-vs-pg-boss-job-queues-nodejs-2026
- **[S8] Frontend** — https://blog.openreplay.com/react-app-libraries/ · https://dev.to/stacknotice/vite-8-complete-guide-rolldown-oxc-and-10x-faster-builds-2026-48lh
- **[S9] Testing** — https://releases.sh/vitest/vitest.md · https://main.vitest.dev/blog/vitest-4-1 · https://node.testcontainers.org/modules/localstack/
- **[S10] AWS emulation** — https://github.com/floci-io/floci · https://floci.io/floci/services/ · https://floci.io/compare · https://wavect.io/blog/floci-vs-localstack-aws-emulator/ · https://blog.localstack.cloud/the-road-ahead-for-localstack/ · https://blog.localstack.cloud/localstack-single-image-next-steps/ · https://dev.to/tarekcheikh/meet-localemu-the-free-successor-to-localstack-1hna · https://dev.to/peytongreen_dev/localstack-is-gone-floci-vs-moto-vs-testcontainers-which-one-replaces-it-c7c · https://encore.dev/articles/localstack-alternatives
- **[S11] Object storage** — https://pinggy.io/amp/blog/minio_archived_self_hosted_s3_alternatives/ · https://glukhov.org/data-infrastructure/object-storage/minio-dead/
- **[S12] IaC** — https://encore.dev/articles/opentofu-vs-terraform-2026 · https://infisical.com/ai/blog/terraform-vs-opentofu
- **[S13] Stripe** — https://docs.stripe.com/api-versions · https://docs.stripe.com/sdks/versioning.md · https://releases.sh/stripe/stripe-node/changelog · https://docs.stripe.com/sandboxes · https://docs.stripe.com/test-mode-sandboxes-comparison
- **[S14] Valkey / BullMQ** — https://docs.bullmq.io/changelog · https://docs.bullmq.io/guide/redis-tm-compatibility/ · https://bullmq.io/articles/benchmarks/valkey-performance-across-versions/ · https://www.cloudmagazin.com/en/2026/04/14/valkey-9-ga-what-the-cache-fork-means-for-dach-ops-teams-18/
- **[S15] Industry** — https://stackoverflow.blog/2026/10/06/the-results-of-the-2026-developer-survey-are-here/ · https://daleseo.com/stack-overflow-survey-2026/ · https://2025.stateofjs.com/en-US/libraries/back-end-frameworks/ · https://www.seekerscore.com/insights/backend-engineer-market-2026 · https://interviewstack.io/blog/backend-developer-skills-companies-want-2026 · https://misujob.com/reports/node-js/2026-06/
- **[S16] Auth and security** — https://www.rfc-editor.org/rfc/rfc10017.html · https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1 · https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html · https://top10.owasp.org/2025/ja/ · https://semgrep.dev/blog/2026/owasp-top-10-2025-whats-new · https://computingforgeeks.com/keycloak-vs-authentik-vs-zitadel-vs-authelia/
- **[S17] Observability** — https://opentelemetry.io/blog/2026/otel-js-sdk-3-0/ · https://www.github.com/grafana/docker-otel-lgtm · https://grafana.com/docs/opentelemetry/docker-lgtm.md
- **[S18] CI** — https://nektosact.com/print.html · https://archlinux.org/packages/extra/x86_64/act/
- **[S19] Docker runtimes** — https://docs.orbstack.dev/faq · https://dev.to/_6638a39c349d7e9c85ee20/best-local-dev-tools-2026-orbstack-vs-colima-vs-rancher-desktop-vs-finch-vs-docker-desktop-4ahi · https://sumguy.pages.dev/colima-vs-orbstack-vs-docker-desktop
- **[S20] Claude** — https://code.claude.com/docs/en/headless.md · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/authentication.md · https://code.claude.com/docs/en/env-vars · https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan · https://thenewstack.io/anthropic-pauses-claude-agent-sdk-subscription-change/ · https://platform.claude.com/docs/en/about-claude/pricing
- **[S21] Spaced repetition** — https://github.com/open-spaced-repetition/ts-fsrs · https://open-spaced-repetition.github.io/ts-fsrs · https://expertium.github.io/Benchmark.html
