# Market research: backend knowledge for fullstack TypeScript roles

Research date: 2026-11-18. Scope: what fullstack job postings ask for on the backend (frontend is assumed known), which TypeScript backend tools are most used today, and how the curriculum in [`technical-spec.md`](./technical-spec.md) section 5 covers them. Stack choices referenced here are in [`stack-decisions.md`](./stack-decisions.md). Section 3 of that file already has an industry check for backend postings; this document adds the fullstack view and the tool-level view.

Nothing in this document changes the spec. Section 5 lists proposed changes, each waiting for Ihor's yes or no, so they can be logged in [`decisions.md`](./decisions.md) once decided.

## 1. Summary

- The curriculum already covers the backend skills that appear most often in fullstack postings: SQL and PostgreSQL, AWS, Docker, CI/CD, REST APIs, microservices, Kubernetes, testing and observability. No high-frequency skill is missing.
- **The largest gap is AI and LLM integration.** 26.5% of fullstack postings ask for generative AI skills (agents, RAG, LLMs, vector databases), more than ask for Kubernetes (21%). Postings that mention it carry a higher median salary. The curriculum has no module on it. [M2]
- **The second gap is the "small team" stack.** Startups that hire fullstack engineers often run the backend inside Next.js or on Hono, use a managed auth library or provider, run jobs on Inngest or Trigger.dev, and deploy to Vercel, Railway or Fly instead of raw AWS. The curriculum teaches the underlying concepts well but names almost none of these tools. [M5][M8]
- **Smaller gaps:** real-time (WebSockets and server-sent events), MongoDB as the second most common non-relational choice, passkeys, Sentry-style error tracking, tRPC, and Postgres full-text search.
- **One correction for module 16:** `kafkajs`, the Kafka client most tutorials use, has had no release since February 2023. Lessons should use `@confluentinc/kafka-javascript`.

## 2. What fullstack postings ask for on the backend

Two posting datasets give percentages. They sample different job boards, so the numbers differ and should be read as ranges.

| Skill | InterviewStack, 7,309 fullstack postings, June 2026 [M1] | Huntr, 13,222-post sample of 132,087 fullstack posts, 2026 [M3] | Curriculum |
|---|---|---|---|
| TypeScript | 45.2% | 34.3% | Module 0, used throughout |
| CI/CD | 42% | about 20%, mostly "preferred" | Module 13 |
| AWS | 39.9% | 21.8% | Modules 9, 11, 14 |
| SQL | 35% | 23.5% | Module 3 |
| APIs / REST API | 34.3% / 24.8% | not given | Module 4 |
| Node.js | 31.1% | 26.1% | Modules 0, 2 |
| Docker | 28.5% | 22.1% | Module 1 |
| PostgreSQL | 26.3% | not given | Module 3 |
| Azure | 25% | not given | Not covered (AWS only) |
| Microservices | 22.1% | not given | Modules 8, 17 |
| Kubernetes | 21% | not given | Module 15 (theory) |
| Google Cloud | 15.9% | not given | Not covered |
| MySQL / MongoDB | 14% / 13.8% | not given | MySQL: transferable from Postgres. MongoDB: not covered |
| Monitoring, GraphQL, Terraform, Kafka, distributed systems, system design | 5–20% each | not given | Modules 12, 4, 14, 16, 17 |
| Python / Java | 33.5% / 32.8% | 31.0% / 33.4% | Out of scope (TypeScript track) |

Co-occurrence in the InterviewStack data: Node.js and TypeScript appear together in 18.6% of fullstack postings, AWS and Node.js in 16.2%, Docker and Kubernetes in 16.2%. Seniority split: 58.5% mid-level, 30.1% senior, 3.4% entry. [M1]

**AI skills in fullstack postings** (InterviewStack, 6,973 fullstack postings, 90 days to June 2026): generative AI skills in 26.5% of postings, 32.8% including classic ML. Named skills: AI agents 10.4%, LLMs 9.8%, RAG 4.2%, vector databases 2.5%. US median base salary $140,000 with AI skills (n=239) against $115,000 without (n=445). Across 45,318 general software engineer postings the share is 20.5%. [M2]

**Salary signals** (InterviewStack, US base, small samples): overall fullstack median $130,000. Observability $150,000 (n=137), system design $143,200 (n=68), Terraform and distributed systems $140,000 each, Node.js $133,700. These support keeping observability, system design and IaC in the core path. [M1]

Caveats: InterviewStack and Huntr are vendors selling interview prep and job-search tools, and neither publishes full methodology. Huntr does not give its date range. Testing and auth are not counted in either dataset, although nearly every posting text mentions them.

## 3. What TypeScript backends use today

### 3.1 Survey usage

Stack Overflow Developer Survey 2026, all respondents [M4]:

| Area | Numbers |
|---|---|
| Databases (n=12,061) | PostgreSQL 57.9%, SQLite 42.1%, MySQL 35.1%, Redis 28.3%, MongoDB 19.0%, Elasticsearch 14.8%, DynamoDB 9.3%, Supabase 7.7%, Valkey 5.0% |
| Web frameworks (n=10,281) | Node.js 46.4%, Next.js 20.6%, Express 15.6%, NestJS 5.8%, Fastify 3.5%, Hono 2.8% |
| Cloud (n=10,889) | AWS 41.8%, Azure 25.1%, Cloudflare 24.6%, Google Cloud 24.5%, Vercel 10.7% |
| Tools (n=10,889) | Docker 59.1%, Kubernetes 26.0%, Terraform 18.3% |
| Testing (n=10,604) | Postman 32.6%, Playwright 24.9%, Jest 20.8%, Vitest 19.4% |
| LLMs | 71.8% of respondents use an LLM; Anthropic and OpenAI each used for work by about three quarters of those |

State of JS 2025 [M6]: Express used by 79.9% of respondents and Next.js by 58.6%. Satisfaction: Hono 95%, Fastify 86%, Express 81%, NestJS 73%, Next.js 55%. Jest 74.4% used, Vitest 53.8%, with Vitest and Playwright each up about 14 points year over year.

### 3.2 Ranking by category

npm figures are approximate weekly downloads from third-party trackers dated February–March 2026 [M5]; the npm downloads API was blocked from this environment, so I could not re-check them. Latest versions and release dates were read from the npm registry on 2026-11-18.

| Category | Most used (in order) | Rising | Notes | Curriculum today |
|---|---|---|---|---|
| HTTP framework | Express (~30M/wk), NestJS (~5M), Fastify (~4M) | Hono (1.5–3M, 4.13.19 released 2026-11-16), Elysia (~400K, Bun) | Express is mostly legacy and transitive downloads, but it is still what most existing code runs on. Next.js route handlers and server actions are the backend in many startup codebases. | NestJS on Express (module 2), Fastify comparison lesson. No Hono, no bare Express, no Next.js backend. |
| ORM / query layer | Prisma (~5M), TypeORM (~3M), Drizzle (~2M), Sequelize (~2M), Kysely (~500K) | Drizzle (about 10x in two years) | TypeORM is slowing but common in NestJS jobs. Prisma 8 is in RC. | Raw SQL, Drizzle, Prisma comparison (module 3). TypeORM not covered. |
| Non-relational | Mongoose (~3M) | — | MongoDB is in 19% of survey answers and 13.8% of fullstack postings. | Not covered. |
| Validation | zod, class-validator, joi | Standard Schema | — | zod and class-validator (module 2). Covered. |
| Auth | Passport (most installed, mostly older Express apps), next-auth (~1.5M) | Better Auth (~500K, up about 10x in a year; 1.7.25 released 2026-11-14) | Lucia is deprecated on npm. Auth.js is maintained by the Better Auth team. Managed: Clerk, Auth0, Supabase Auth, WorkOS, Cognito. Passkeys are becoming the default sign-up path. [M7] | Sessions, JWT, OIDC with Keycloak (module 6). No library or managed provider, no passkeys. |
| Cache | Redis, Valkey | — | — | Valkey (module 7). Covered. |
| Jobs and workflows | BullMQ | Inngest (4.26.2), Trigger.dev (4.8.5), Temporal (1.26.0) | Startup stack articles recommend Inngest or Trigger.dev over self-hosted queues. Resend runs on Inngest. [M8] | BullMQ (module 7), pg-boss in the platform. No hosted or durable-workflow tools. |
| Messaging | SQS/SNS, Kafka, RabbitMQ | — | `kafkajs` 2.2.4 is from 2023-02-27; `@confluentinc/kafka-javascript` 1.11.0 is from 2026-10-07. | SQS/SNS/EventBridge (module 11), Kafka theory (module 16). RabbitMQ not covered. |
| API style | REST + OpenAPI | tRPC (11.29.4, released today), server actions | GraphQL in 9–15% of postings. | REST, OpenAPI, GraphQL and gRPC compared (module 4). No tRPC. |
| Real-time | socket.io (4.8.4), ws | SSE for LLM streaming | Supabase Realtime, Pusher and Ably are the managed options. | Not covered. |
| Testing | Jest, Vitest, Supertest, Playwright | Vitest, Testcontainers | Jest is still slightly ahead in the SO survey and is NestJS's default for CommonJS projects. | Vitest, Supertest, Testcontainers (module 5). Jest not named. |
| Observability | pino, winston, OpenTelemetry | — | Startups pair Sentry (errors) with PostHog (product analytics). | OTel, pino, LGTM stack (module 12). No Sentry. |
| Hosting | AWS | Vercel, Railway, Render, Fly, Cloudflare Workers | AWS still leads, but small teams start on a PaaS. [M8] | AWS via emulator (modules 9, 11, 14). No PaaS. |
| Database hosting | RDS | Supabase, Neon (branching), PlanetScale Postgres | Supabase leans on Postgres Row-Level Security. | Postgres 18 in Docker. RLS not covered. |
| Email and webhooks | Resend, Postmark, SendGrid; Svix | — | Transactional email is in almost every SaaS. | Stripe webhooks (module 10). No email. |
| AI integration | `ai` (Vercel AI SDK, 7.0.176), `openai`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` (1.32.2) | pgvector, MCP servers | 26.5% of fullstack postings. | Not covered. |

## 4. Coverage and gaps

### 4.1 Covered well

PostgreSQL and SQL depth, Docker, AWS building blocks, CI/CD, IaC, REST and OpenAPI, testing with real databases, sessions, JWT and OIDC, OWASP, caching and queues, reliability patterns, Stripe, observability, Kubernetes and Kafka as theory, and system design. This matches the top of both posting datasets. Nothing in the curriculum looks unneeded.

### 4.2 Gaps, ranked by market weight

| # | Gap | Evidence | Size |
|---|---|---|---|
| G1 | **LLM integration on the backend:** calling models, streaming over SSE, structured output and tool calling, RAG with pgvector, cost and rate limits, evaluation, prompt-injection risks, MCP servers | 26.5% of fullstack postings; salary premium; 71.8% of developers already use LLMs [M2][M4] | Large |
| G2 | **Backends outside NestJS:** bare Express, Hono, and Next.js route handlers and server actions | Next.js 20.6% and Express 15.6% against NestJS 5.8% [M4] | Medium |
| G3 | **Real-time:** WebSockets, Socket.IO, SSE, scaling with Redis pub/sub | Common in product work; SSE is also how LLM responses stream | Medium |
| G4 | **Auth libraries, managed providers and passkeys:** Passport, Better Auth, one managed provider (Clerk, Auth0 or Cognito), WebAuthn | Better Auth growth; Lucia deprecated; passkeys as default [M7] | Small to medium |
| G5 | **Small-team deployment:** a PaaS (Railway, Render or Fly), serverless Postgres (Neon, Supabase), Postgres Row-Level Security | Startup stack articles agree on this layer [M8]; Vercel 10.7%, Supabase 7.7% [M4] | Small to medium |
| G6 | **Hosted job and workflow services:** Inngest or Trigger.dev, and Temporal's durable-execution idea | Recommended default in startup stacks [M8] | Small |
| G7 | **MongoDB:** document modelling, Mongoose, when to choose it | 19% of developers, 13.8% of fullstack postings [M1][M4] | Small |
| G8 | **Error tracking:** Sentry, release health, source maps | Default in startup stacks [M8] | Small |
| G9 | **tRPC and typed contracts** | Common in TypeScript-only startups; active project | Small |
| G10 | **Search:** Postgres full-text search, with Elasticsearch named | Elasticsearch 14.8% [M4] | Small |
| G11 | **Transactional email** (Resend or Postmark) and outbound webhooks (Svix-style signing and retries) | Present in most SaaS stacks [M8] | Small |
| G12 | **Jest and TypeORM** as "what you meet in existing code" | Jest 20.8% vs Vitest 19.4%; TypeORM ~3M/wk | Small |

Not treated as gaps: Azure and Google Cloud (concepts transfer from AWS), Python and Java (out of scope), RabbitMQ (covered conceptually by SQS and Kafka; one paragraph is enough).

## 5. Proposed changes

Each item names where it would go. None is applied. Effort uses the spec's S/M/L scale.

1. **New core module: "LLM features in a backend"** (G1), effort M, placed after module 12 so it can use queues, observability and testing. Lessons: provider SDKs and the Vercel AI SDK; streaming over SSE; structured output and tool calling; embeddings and RAG with pgvector in the lab Postgres; cost, rate limits, retries and caching; evaluating output; prompt injection and data leakage (OWASP LLM Top 10); building a small MCP server. Practice can use the learner's Claude plan through Copy for Claude, or a local model, so no API key is required. *Needs Ihor's decision: core, optional, or skip.*
2. **Module 2, add a "framework landscape" lesson** (G2): the same three endpoints in bare Express, Hono and a Next.js route handler, then what NestJS adds. Mention TypeORM in module 3's Prisma comparison (G12).
3. **Module 4, add two lessons** (G3, G9): real-time with WebSockets, Socket.IO and SSE (including scaling with Valkey pub/sub), and tRPC compared with OpenAPI codegen.
4. **Module 6, add two lessons** (G4): passkeys with WebAuthn, and "build or buy": Passport and Better Auth against one managed provider, with the trade-offs.
5. **Module 7 or 8, add one lesson** (G6): hosted job services and durable workflows (Inngest or Trigger.dev, Temporal), compared with BullMQ and pg-boss.
6. **Module 3, add two optional lessons** (G7, G10, G5): MongoDB and when a document store fits; Postgres full-text search and Row-Level Security.
7. **Module 12, add a Sentry lesson** (G8), and **module 13, add a "deploy to a PaaS" lesson** (G5) covering Railway, Render or Fly and a Neon branch per pull request. These need a free account, so they are optional.
8. **Module 10 or 11, add transactional email and outbound webhooks** (G11), using a local mail catcher (Mailpit) so no account is needed.
9. **Module 16:** use `@confluentinc/kafka-javascript` in examples and say why `kafkajs` is no longer the default.
10. **Module 5:** one section mapping Vitest to Jest, since many existing codebases still use Jest (G12).

If all are accepted, the curriculum grows by one M module and about 12 lessons, most of them optional.

## 6. Known gaps in this research

- I could not query the npm downloads API from this environment. Download numbers come from PkgPulse pages dated February–March 2026 that disagree with each other (Express ~30M vs ~35M, Hono ~1.5M vs ~3M).
- Neither posting dataset breaks out NestJS, Express, Prisma, testing tools or auth. Tool-level demand in postings is inferred from surveys and stack articles, not counted.
- The startup stack articles are mostly from vendors (MakerKit, Resend, CODERCOPS). They show what small teams choose, not how often.
- The Stack Overflow figures are for all respondents; I did not find a professional-only breakdown.
- State of JS usage numbers for NestJS, Fastify and Hono were in a part of the page that did not load.

## 7. Sources

- **[M1] InterviewStack, fullstack skills (7,309 postings, June 2026)** — https://interviewstack.io/blog/fullstack-developer-skills-companies-want-2026
- **[M2] InterviewStack, AI in fullstack and software engineer postings** — https://interviewstack.io/blog/how-ai-is-changing-fullstack-developer-2026 · https://interviewstack.io/blog/how-ai-is-changing-software-engineering-2026
- **[M3] Huntr, 132,087 fullstack posts** — https://huntr.co/resume-skills/full-stack-developer
- **[M4] Stack Overflow Developer Survey 2026, technology data** — https://survey.stackoverflow.co/2026/technology/data
- **[M5] Framework and ORM downloads and trends** — https://www.pkgpulse.com/guides/decline-of-express-what-developers-switching-to-2026 · https://www.pkgpulse.com/guides/hono-vs-express-vs-fastify-2026 · https://www.pkgpulse.com/guides/state-of-nodejs-orms-2026 · https://encore.dev/resources/node-js-frameworks · https://encore.dev/resources/prisma-vs-drizzle-vs-typeorm
- **[M6] State of JavaScript 2025, libraries** — https://2025.stateofjs.com/en-US/libraries/
- **[M7] Auth** — https://www.pkgpulse.com/guides/better-auth-vs-lucia-vs-nextauth-2026 · https://dev.to/devansh2002/nodejs-authentication-libraries-in-2026-what-production-teams-actually-use-3ggj · https://workos.com/blog/top-authentication-solutions-node-js-2026 · https://clerk.com/articles/authentication-trends-in-2026-passkeys-ai-agents-and-edge-4
- **[M8] Startup and small-team stacks** — https://makerkit.dev/blog/saas/saas-stack-2026 · https://resend.com/handbook/engineering/what-is-our-tech-stack · https://blog.codercops.com/blog/startup-tech-stack-decisions-2026 · https://dev.to/sonotommy/8-tools-powering-the-fastest-growing-startups-in-2026-5hib
- **[M9] npm registry** (versions, release dates, deprecation flags, read 2026-11-18) — https://registry.npmjs.org/
- Supporting, not cited for numbers: https://www.nucamp.co/blog/most-in-demand-full-stack-skills-in-2026-react-node-typescript-and-beyond · https://jobrise.io/en/blog/full-stack-developer-skills-2026/
