# Interview question bank: fullstack (backend-heavy) roles at startups and small companies

Status: 2026-11-18. Research input for the curriculum in [`technical-spec.md`](./technical-spec.md), section 5. Frontend knowledge is assumed, so frontend questions are left out. Module numbers (M0–M17) refer to that curriculum.

How to use this file: each question is a candidate flashcard, written task or mock-interview prompt for its module. The "Coverage gaps" section lists topics interviewers ask about that the curriculum does not yet teach.

A caveat on sources: there is no public dataset of questions actually asked at small companies. The sources below are recruiter blogs, company write-ups and editorial question lists. Where several independent sources repeat the same topic, it is marked **★** as a high-frequency topic. The rest is lower confidence.

## 1. What the interview loop looks like

**Shape.** Startups (seed to Series C) usually run 3–5 rounds over 1–3 weeks, against 5–7 rounds over several weeks at big tech [5]. A typical sequence is a recruiter or founder screen (~30 min), a hiring manager call (~45 min), one technical round (60–90 min), then a short final loop of 3–5 sessions in one day [1].

**Technical formats you will meet, most to least common at small companies:**

| Format | What it looks like | What is judged |
|---|---|---|
| Practical live coding or pair programming | 60–90 min, build or extend a small feature or endpoint in a real editor, often in TypeScript [3][5] | Clean, tested code, sensible types, asking clarifying questions; not algorithm puzzles [3] |
| Take-home project | 4–8 h, a small API or fullstack app, then a follow-up call to walk through and extend it [5] | Structure, tests, README, trade-offs you can defend. Some companies avoid take-homes to respect your time [3] |
| Code review round | 30–60 min reviewing a real or seeded pull request [5] | Spotting bugs, security issues, N+1 queries, missing tests; tone of feedback |
| Pragmatic system design | 45 min: requirements, architecture, failure modes, trade-offs [1]. Framed as "10K users now, 100K next year" [5] | Right-sized design. Kubernetes for 5 engineers and 1,000 users is a red flag [5] |
| Technical deep dive | "Walk me through the Node.js event loop" [2], or a project from your CV in depth | Depth on what you claim to know |
| Debugging | A slow query, a race condition in CI, a memory leak [2][7] | Method: measure first, form hypotheses, verify |
| Light algorithms | Two Sum, reverse a linked list [2] | Big-O and basic data structures. Less common at small product companies, but not rare |

**Scoring.** Common rubric dimensions: problem decomposition, technical depth for the level, articulating trade-offs, ownership, and culture add [1]. At founder-led companies the behavioural signal often comes from conversation rather than a scorecard [4].

## 2. Technical questions by topic

### M0. Node runtime, HTTP, TypeScript

- ★ What is the event loop, and why does Node need it? Name the phases in order. [6][7]
- ★ `process.nextTick()` vs `setImmediate()` vs `setTimeout(fn, 0)`. Where do promise microtasks run? Predict the output order of a snippet. [6][7]
- ★ How do you detect and fix a blocked or lagging event loop in production? [6][7]
- ★ `worker_threads` vs `cluster` vs `child_process`: when do you use each? How do you handle a CPU-bound task (image resize, PDF generation, hashing)? [6][7][10]
- ★ How would you find and fix a memory leak in a long-running Node process? [6][7][10]
- What is backpressure in streams, and how do you handle it? When would you stream a response instead of buffering it? [7]
- How do you implement graceful shutdown for an HTTP server with open connections and in-flight jobs? (SIGTERM, stop accepting, drain, close pools.) [7][8]
- What is `AsyncLocalStorage` for, and what does it cost? (Request ids, tracing.) [7]
- How is Node different from a thread-per-request server? Why choose it over Java or PHP? [6]
- HTTP: what makes a method idempotent or safe? Status codes for validation errors, auth failure vs forbidden, conflicts, rate limiting. What do `Cache-Control`, `ETag` and CORS preflight do?
- TypeScript on the backend: `unknown` vs `any`, discriminated unions for results and errors, why types alone do not validate input at runtime (hence zod or class-validator).

### M2. NestJS

- ★ How does dependency injection work in NestJS? How does the container resolve providers? [8]
- ★ What is the request lifecycle order? Middleware, guards, interceptors, pipes, controller, interceptors again, exception filters. When do you use each? [8]
- Provider scopes (singleton, request, transient): when would you leave the default, and what does request scope cost? [8]
- How do you resolve a circular dependency between two providers, and why is it usually a design smell? [8]
- How do you validate and transform request bodies? Global `ValidationPipe`, DTOs, whitelisting unknown fields.
- How do you structure config and secrets per environment, and fail fast on a missing variable?
- How do you return consistent error responses from every endpoint? (Exception filter, RFC 9457 problem details.)
- How do WebSocket gateways work, and how would you scale them past one instance? [8]

### M3. PostgreSQL and data modelling

- ★ Transaction isolation levels in PostgreSQL. Which anomalies does each prevent? Does Postgres support Read Uncommitted? [9][11]
- ★ How does MVCC work? Why do dead tuples exist, and what do VACUUM and autovacuum do? Does VACUUM return disk space to the OS? [9]
- ★ Which index would you choose (B-tree, GIN, BRIN, partial, composite, covering)? How does column order in a composite index matter? [9][11]
- ★ How do you read an `EXPLAIN ANALYZE` plan? Why might Postgres do a sequential scan when an index exists? Does `EXPLAIN ANALYZE` run the query? [9]
- ★ A query became slow after a large data load. Walk through how you investigate. [9]
- Write SQL live: top N per group, a join with aggregation, find duplicates, a window function such as running totals.
- Normalise this schema. When would you denormalise on purpose?
- What is the N+1 query problem, and how do you spot and fix it with an ORM? [2]
- How do you run a migration that adds a NOT NULL column or an index to a large, live table without downtime?
- Connection pooling: why does it matter for Node, and what happens when the pool is exhausted? How do you tell pool exhaustion from a deadlock? [10]
- Handling serialization failures and deadlocks (SQLSTATE 40001 and 40P01): when should the app retry? [9]
- ORM vs query builder vs raw SQL (Prisma, Drizzle, TypeORM): trade-offs.
- SQL vs NoSQL: when would you pick DynamoDB or MongoDB over Postgres?

### M4. API design

- Design the REST API for a given resource: URLs, methods, status codes, error shape.
- ★ Offset vs cursor pagination: trade-offs, and why offset breaks on large or changing tables.
- How do you version an API, and how do you evolve it without breaking clients?
- How do idempotency keys work? How would you make `POST /payments` safe to retry?
- REST vs GraphQL vs gRPC: when is each the right call? What is the N+1 problem in GraphQL and how do DataLoaders help?
- How do you document and keep an API contract in sync (OpenAPI generation, contract tests)?

### M5. Testing

- Unit vs integration vs end-to-end: what do you test at each level, and why?
- How do you test code that uses a database? Mocks vs a real database in Testcontainers.
- Mock vs stub vs fake vs spy.
- What would you test in this endpoint? (Common in take-home follow-ups and code reviews.)
- How do you keep a test suite fast and not flaky?

### M6. Auth and security

- ★ Sessions vs JWTs: trade-offs, where to store tokens in a browser, how to revoke a JWT. [6]
- Access and refresh tokens: how does rotation work, and how do you detect reuse?
- OAuth 2 vs OpenID Connect. Walk through the authorisation code flow with PKCE.
- ★ How do you prevent XSS, CSRF and SQL injection in a Node app? [6]
- How should passwords be stored? Why argon2id or bcrypt and not SHA-256?
- RBAC vs ABAC, and where authorisation checks belong. What is broken object-level authorisation (BOLA, the top API security risk)?
- How do you manage secrets, and what would you do if a key leaked to git?
- Multi-tenancy: how do you keep one customer's data away from another's (tenant id on every query, row-level security)?

### M7. Caching, queues, rate limiting

- ★ When would you add a cache, and what would you cache? Cache-aside vs write-through. How do you invalidate it? [2]
- What is a cache stampede and how do you prevent it?
- ★ Design or implement a rate limiter (fixed window, sliding window, token bucket). Where does its state live with several API instances?
- When do you move work to a background job? How do retries, backoff and dead-letter queues work in BullMQ or SQS?
- What delivery guarantee does your queue give, and how do you make consumers idempotent?

### M8. Reliability and concurrency

- ★ Two requests update the same row at the same time. How do you avoid lost updates? Optimistic vs pessimistic locking, `SELECT … FOR UPDATE`.
- Timeouts, retries with exponential backoff and jitter, circuit breakers: when and why.
- What is the outbox pattern, and what problem does it solve (dual writes to DB and queue)?
- Sagas vs distributed transactions.
- An external API your service depends on is down. What does your service do?

### M9–M11. Files, payments, AWS

- How would you let users upload large files? Presigned URLs, multipart upload, validating type and size, scanning.
- ★ (Very common at SaaS startups.) How do you integrate Stripe subscriptions? How do you handle webhooks safely: signature verification, duplicates, out-of-order events, retries?
- How do you keep your database in sync with the payment provider (reconciliation)?
- SQS vs SNS vs EventBridge. When would you use Lambda instead of a long-running service?
- IAM basics: least privilege, roles vs users, how a service gets credentials without a key in code.

### M12. Observability and production

- ★ p99 latency on an endpoint spiked after a deploy. Describe your diagnostic process. [10]
- Logs vs metrics vs traces. What goes in a structured log line? How do you correlate logs across services (request ids, trace context)?
- What would you alert on, and how do you avoid alert fatigue?
- Tell me about a production incident you handled. (Technical and behavioural at once.)
- "Database connection timeout" alerts are firing. What do you check first? [10]

### M13–M14. CI/CD, Docker, IaC

- Walk through the CI pipeline you would set up for this repo.
- How do you deploy without downtime, and how do you roll back? How do database migrations fit into a deploy?
- What makes a good Dockerfile for a Node app (multi-stage, layer caching, non-root user, small base)?
- Feature flags: why use them, and what do they cost?
- What does Terraform/OpenTofu state hold, and how do you manage environments?

### M15–M16. Kubernetes and Kafka (usually theory at small companies)

- When is Kubernetes worth it, and when is a PaaS or a single container service enough? Interviewers at small companies often check you would *not* over-engineer. [5]
- Liveness vs readiness probes.
- Kafka vs SQS vs BullMQ: when would you choose each? Partitions, consumer groups, ordering, exactly-once vs at-least-once.

## 3. System design prompts sized for startups

Interviewers at small companies want a design that a team of 3–10 can build and run. Start with a monolith and Postgres, and add pieces only when a requirement forces it [5]. Practise a 45-minute structure: requirements and numbers, API, data model, architecture, failure modes, trade-offs [1].

Most-cited prompts (★ = appears across many lists) [2][6][12][13]:

1. ★ URL shortener
2. ★ Rate limiter (as an API middleware and as a distributed service)
3. ★ Notification system (email, push, in-app) with retries and user preferences
4. ★ Chat or real-time collaboration backend (WebSockets, presence, fan-out)
5. File upload and processing pipeline (presigned upload, queue, thumbnails or virus scan)
6. Multi-tenant SaaS backend with subscriptions and billing webhooks
7. Job scheduler or background task system
8. Activity feed or news feed for a small social product
9. Webhook delivery service (retries, signing, per-customer ordering)
10. Search and filtering over a growing product catalogue (Postgres full-text first, then a search engine)

Follow-ups to expect: "What breaks first at 10x traffic?", "Where would you add a cache and how do you invalidate it?", "What happens if this worker crashes halfway?", "How do you deploy a schema change here?"

These map to **M17** (design reviews and capstone). Prompts 5, 6 and 9 also exercise M9, M10 and M7.

## 4. Take-home and pair-programming exercises

Typical briefs at small companies (synthesised from the formats in [3][5]):

- Build a small REST API (tasks, bookings, inventory, URL shortener) with validation, persistence, tests and a README. Follow-up call: add a feature or fix a bug live.
- Add pagination, filtering and sorting to an existing endpoint.
- Implement an in-memory or Redis-backed rate limiter and test it.
- Consume a flaky third-party API with timeouts, retries and caching.
- Process a webhook: verify the signature, store the event idempotently, update state.
- Review a pull request with seeded issues (SQL injection, N+1, missing auth check, no tests, unhandled promise).

What reviewers look for: tests, clear structure, input validation, error handling, a README that states assumptions and trade-offs, and scope discipline (do what was asked well, and list what you would do next) [1][3].

Platform fit: these work as M17 "mock interview" tasks with stage 1 checks (HTTP probes, test results) and a Claude review against a rubric similar to the scoring dimensions in section 1.

## 5. Behavioural and startup-fit questions

Startups weight shipping speed, ownership and comfort with ambiguity. Answers like "the architecture review took four weeks" or "I escalated to my manager's manager" read badly; "I shipped X in two weeks" reads well [4].

- Tell me about a project you are proud of. What was your part, and what would you change? [2][3]
- Tell me about a challenging project that forced you to learn something new. [3]
- Tell me about a time you disagreed with a teammate or your manager. [2]
- Tell me about a time you shipped with incomplete requirements. How did you decide what to build?
- Tell me about a production incident or a bug you caused. What did you change afterwards?
- When have you cut scope or taken on tech debt deliberately? How did you pay it back?
- Why a startup instead of a big company? [5]
- What would you do if our main product thesis turned out to be wrong? [5]
- How do you stay current? [2] How do you use AI coding tools, and how do you check their output? [6]
- What questions do you have for us? (Prepare questions on runway, team size, on-call, how decisions get made.)

Use a short STAR shape (situation, task, action, result), but founder-led interviews are more conversational than scored [4].

## 6. Coverage gaps in the current curriculum

Topics interviewers ask about that the 18 modules do not clearly cover:

| Gap | Asked in | Suggested home |
|---|---|---|
| Real-time: WebSockets, SSE, scaling socket connections | Chat and notification design, NestJS gateways [6][8] | New lesson in M7 or M17 |
| Live SQL writing (window functions, top-N per group) | Practical rounds | Add SQL drills to M3 |
| Zero-downtime migrations and deploys, rollbacks | Deploy and schema questions | Lesson in M3 and M13 |
| Multi-tenancy and row-level security | SaaS design | Lesson in M6 or M17 |
| Node performance diagnosis: heap snapshots, event-loop lag, profiling | Senior Node questions [6][7] | Task in M0 or M12 |
| Light algorithms and data structures (Big-O, hash maps, two pointers) | Some screens [2][3] | Optional module or a card deck |
| Code review as an interview format | Code review rounds [5] | Mock-interview task in M17 |
| Behavioural preparation and a story bank | Every loop [1][4] | Optional "Interview prep" module after M17 |
| Search (Postgres full-text, then a search engine) | Catalogue and feed design | Lesson in M3 |

Suggestion: add an optional **M18 Interview prep** module with a timed mock system design (diagram upload, Claude review), a take-home under a time box, a code-review task on a seeded PR, a behavioural story bank as written answers, and a deck of the ★ questions above.

## Sources

1. Underdog.io, "Startup Interview Process: Stages, Timelines, and Tips" (2026). https://underdog.io/blog/startup-interview-process
2. Underdog.io, "The Top 10 Software Engineer Interview Questions Startups Use in 2026". https://underdog.io/blog/software-engineer-interview-questions
3. Trunk.io, "How we crack the coding interview" (2024, one company's own process). https://trunk.io/blog/how-we-crack-the-coding-interview
4. techinterview.org, "Behavioral Interview at Startup vs FAANG: Different Calibrations" (2026). https://www.techinterview.org/post/3233474692/behavioral-startup-vs-faang/
5. Kinda Technical, "Startup vs Big Tech Interviews: How They Differ" (2026, unsourced figures). https://kindatechnical.com/technical-interview-preparation/startup-vs-big-tech-interviews-how-they-differ.html
6. DEV Community, "Node.js Developer Interview Questions in 2026: What's Actually Being Asked". https://dev.to/deepakjaiswal/nodejs-developer-interview-questions-in-2026-whats-actually-being-asked-3o89
7. GreatFrontEnd, "Senior Node.js Developer Interview Questions: Advanced Topics and Answers" (2026). https://www.greatfrontend.com/blog/senior-nodejs-developer-interview-questions-advanced-topics-and-answers
8. Hyring, "Top 60 NestJS Interview Questions (2026)". https://hyring.com/jobseeker-toolkit/interview-questions/technical/nestjs
9. PracHub, "PostgreSQL Interview Questions: MVCC, Indexes, Query Plans, and Transactions" (2026). https://prachub.com/resources/postgresql-interview-questions-mvcc-indexes-query-plans-and-transactions
10. AI VOID, "Real-World Case Studies & Scenario Questions" (2026, AI-assisted content). https://ai-void.pages.dev/nodejs-backend-interview-2026/real-world-case-studies-scenario-questions
11. DataCamp, "Top PostgreSQL Interview Questions for All Levels". https://www.datacamp.com/blog/top-postgresql-interview-questions-for-all-levels
12. Design Gurus, "Top 10 System Design Interview Questions". https://designgurus.substack.com/p/top-10-system-design-interview-questions
13. Educative, "Top 20 System Design Interview Questions in 2026". https://www.educative.io/courses/grokking-the-system-design-interview/top-20-system-design-interview-questions-in-2026

Unmarked questions without a citation are standard topics added to round out each module. They come from general knowledge of backend interviews, not from a specific source above.
