# Authoring lessons, cards and tasks

Everything the learner reads lives under `curriculum/` as Markdown and YAML. The API validates it at start-up. Run `pnpm curriculum:check` after every change; it lists each problem with the file at fault.

## Layout

```
curriculum/
  m03-postgres/                  # mNN-slug. NN sets the order.
    module.yaml
    l01-relational-model/        # lNN-slug
      lesson.md
      cards.yaml
    t01-schema-design/           # tNN-slug
      task.yaml
      task.md
      starter/                   # repo tasks: copied into the learner's lab repo
      checks/                    # repo tasks: hidden check suite
      solution/                  # repo tasks: reference solution, never shown
```

## module.yaml

```yaml
title: PostgreSQL and data modelling
summary: One or two sentences on what the learner can do after this module.
kind: core            # core | optional
effort: L             # S | M | L, relative to other modules. Never weeks or hours.
services: [postgres]  # practice services the tasks need; [] for reading-only modules
skills:
  - { id: sql-indexes, title: Indexes }
```

Declare every skill the module's lessons, cards and tasks refer to. Skill ids are global, so reuse an id from an earlier module rather than declaring a near-duplicate.

## lesson.md

```markdown
---
title: How indexes work
skills: [sql-indexes]
---

Opening paragraph: what this is and why it matters, in two or three sentences.

## Section heading
...
```

Rules for lesson text:

- **Original and concise.** Aim for 800–1,500 words of prose, not counting code blocks. Above about 1,800, split the lesson. Explain the idea, show one worked example, name the common mistakes. Do not copy documentation.
- **Written for this learner:** a strong React and TypeScript developer with basic backend knowledge. Compare with frontend concepts where it helps. Do not explain what a function or a Promise is.
- **Plain language.** Short sentences, active voice, British or American spelling used consistently within a lesson. No filler, no hype.
- **Code blocks** have a language tag (`ts`, `sql`, `sh`, `yaml`, `dockerfile`, `http`, `json`). Keep them short and runnable. TypeScript examples are ESM and target Node 24+.
- **Do not start the body with an H1.** The title comes from the front matter. Use `##` and `###`.
- **End with two sections:** `## Common mistakes` (a short list) and `## Go deeper` (3–5 links to official documentation or specifications, each with a few words on what it adds). Link only to pages you are confident exist: official docs roots (nodejs.org, docs.nestjs.com, postgresql.org/docs, developer.mozilla.org, docs.docker.com, rfc-editor.org and similar). Prefer a stable section URL to a deep link you are unsure about.
- **Versions:** Node 26 LTS (24 minimum), TypeScript 7, NestJS 12 (ESM, Express 5), PostgreSQL 18, Docker Compose v2. Do not state a version number you are not sure of; say "current" instead.

## cards.yaml

Six to ten cards per lesson.

```yaml
- id: btree-default            # stable; renaming creates a new card
  type: concept                # term | concept | cloze | comparison | snippet
  front: Why can a B-tree index serve `ORDER BY created_at` without a sort step?
  back: Its leaf entries are already stored in key order, so the planner can read them in sequence.
  skills: [sql-indexes]
```

- **Quote YAML strings that contain a comma or a colon followed by a space.** `{ id: x, title: a, b }` and a plain scalar containing `: ` both fail to parse.
- One fact or idea per card. If the answer needs "and", split the card.
- `term`: a name on the front, a one-sentence definition and a tiny example on the back.
- `concept`: a "why" or "what happens when" question.
- `cloze`: the front is a sentence or snippet with `{{...}}` in place of the hidden part; the back is the hidden part.
- `comparison`: "X vs Y" on the front; the deciding difference on the back.
- `snippet`: a task on the front ("Create a presigned S3 upload URL with SDK v3"); the minimal code on the back.
- Fronts are questions a person could answer from memory in under 15 seconds. Backs are at most three short lines. Markdown and inline code are allowed.

## Tasks

At least three per core module. Mix the types: mostly `repo` for hands-on modules, `text` for explanations and design questions.

### task.yaml

```yaml
title: Add a composite index
type: repo               # repo | text | diagram
skills: [sql-indexes]
services: [postgres]     # must be a subset of the module's services
runner: node             # node | nest. Only for repo tasks.
hints:
  - Column order in a composite index follows equality first, then range.
criteria:                # stage 1. One per check. Required for repo tasks.
  - { id: uses-index, title: The query plan uses an index scan }
rubric:                  # stage 2. What Claude scores. Required for every task.
  - { id: index-choice, title: Index matches the query shape, skill: sql-indexes, max: 4 }
  - { id: explanation, title: README explains the trade-off, max: 4 }
limits: { timeoutSeconds: 120 }   # optional sandbox overrides
```

### task.md

The brief the learner reads: the goal, the exact requirements (file names, exported names, ports, routes), what must be in the submission, and what will be checked. Be precise enough that the checks cannot surprise anyone. 150–350 words.

### starter/

Files copied into the learner's lab repo at `lab/<module>/<task>/`. Give a working skeleton with `TODO` markers, never a half-solution. Do not include `node_modules` or lock files.

### checks/

The hidden check suite. The contract:

- Files are named `*.test.mjs` and run with Node's built-in test runner: `node --test "checks/*.test.mjs"`. (A bare directory argument does not work on Node 24.)
- They may use only Node built-ins (`node:test`, `node:assert/strict`, `node:fs`, `node:child_process`, `fetch`). The sandbox has no internet and cannot install packages.
- The submission is in the directory named by the `SUBMISSION_DIR` environment variable. It is writable, so the checks may compile or run it there.
- **Each top-level `test()` is one criterion, and its name starts with the criterion id followed by a colon:** `test('uses-index: the query plan uses an index scan', ...)`. Every id in `task.yaml` needs exactly one such test.
- Assertion messages are shown to the learner. Say what was expected and what was found, without giving the solution away.
- With `runner: nest`, the packages in `infra/docker/runner-nest/package.json` are available to the submission through a `node_modules` folder that the sandbox places in `SUBMISSION_DIR`. Compile with `node_modules/.bin/tsc` and import the output.
- Practice services are reached through environment variables: `LAB_DATABASE_URL`, `LAB_VALKEY_URL`, `AWS_ENDPOINT_URL`.
- Checks must finish well inside the timeout, clean up child processes, and listen only on `127.0.0.1` with port `0` or a port read from the environment.

### solution/

A complete reference solution with the same layout as `starter/`. It exists to prove the checks: they must pass against `solution/` and at least one must fail against `starter/`. Verify both before you finish:

```sh
SUBMISSION_DIR=$(mktemp -d) && cp -R curriculum/<module>/<task>/solution/. "$SUBMISSION_DIR" \
  && SUBMISSION_DIR="$SUBMISSION_DIR" node --test "curriculum/<module>/<task>/checks/*.test.mjs"
```

### Text and diagram tasks

No `criteria`, `starter`, `checks` or `solution`. The rubric does all the work, so make each item observable ("names at least two failure modes and how each is detected") and never vague ("good understanding").

## Tasks that use practice services

List the services in `task.yaml`, for example `services: [postgres]`. Known names: `postgres`, `valkey`, `aws`, `mailpit`. The learner starts them with `pnpm lab up <name>`, and the check run refuses to start, with that instruction, when one is down.

The sandbox reaches a service by its name on a network without internet. The check suite and the submission get these environment variables:

| Service | Variables | Isolation |
|---|---|---|
| any | `CHECK_RUN_ID` | unique per run |
| `postgres` | `DATABASE_URL` | a new empty database per run, dropped afterwards |
| `valkey` | `VALKEY_URL`, `VALKEY_KEY_PREFIX` | prefix every key with the given prefix |
| `aws` | `AWS_ENDPOINT_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_RESOURCE_PREFIX` | prefix every bucket, queue and table name |
| `mailpit` | `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL` | filter by a recipient that contains `CHECK_RUN_ID` |

Notes for `aws` (verified with the emulator and AWS SDK 3.1169):

- The SDK reads `AWS_ENDPOINT_URL` by itself. Create S3 clients with `forcePathStyle: true`.
- Create SQS clients with `useQueueUrlAsEndpoint: false`. The emulator returns queue URLs with `localhost` in them, which is wrong inside the sandbox.
- Presigned S3 URLs work inside the sandbox with `fetch`.

Rules:

- The submission must read its connection settings from these variables. Say so in the brief, and name the variables.
- Checks must leave nothing behind in Valkey, the emulator or Mailpit. The Postgres database is removed for you.
- A task that needs a package (for example `pg`) uses `runner: nest` and may only import what `infra/docker/runner-nest/package.json` lists. Add a package there when a module needs one, and list it in your report.
- To run such checks outside the sandbox while authoring, publish the service port (`pnpm lab up postgres` publishes 55432) and set the variables yourself, for example `DATABASE_URL=postgres://lab:lab@localhost:55432/lab`.
