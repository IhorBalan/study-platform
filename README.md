# Study platform

A local-first platform for learning backend engineering: lessons, hands-on tasks with automated checks and a Claude review, spaced repetition, and progress statistics. It is built with the stack it teaches (React, NestJS, PostgreSQL) and runs entirely on your own machine.

- [`docs/technical-spec.md`](docs/technical-spec.md): what the platform is and how it is built.
- [`docs/decisions.md`](docs/decisions.md): every decision made while building it, with the reasoning and the alternatives.
- [`docs/authoring.md`](docs/authoring.md): how lessons, card decks and tasks are written.

## Requirements

- macOS on Apple Silicon (Linux also works)
- Node.js 24 or newer (26 LTS recommended; `.nvmrc` is provided)
- pnpm 11 (`corepack enable` picks the pinned version up)
- A Docker runtime: OrbStack, Colima or Docker Desktop

No cloud accounts are needed. Module 15 teaches OpenTofu; if you want to run its examples, install it yourself (`brew install opentofu`). The platform does not need it. Two optional parts need a free account of their own: error tracking with Sentry (module 12) and deploying to a PaaS (module 14).

## Run it

```sh
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` creates `.env` on first run, starts PostgreSQL in Docker, then starts four processes with hot reload: the web app on http://localhost:5173, the API on http://localhost:3000/api, the worker, and the host bridge that runs task checks. Data lives in a Docker volume and survives restarts. `pnpm infra:down` stops the database and keeps the data.

### Backups and moving to another machine

All progress (lessons done, cards and their schedule, submissions, reviews, settings) lives in the platform database, in one Docker volume. Nothing else holds it, so back it up:

```sh
pnpm backup                                        # writes backups/study-YYYY-MM-DD-HHmm.dump, keeps the newest 14
pnpm restore backups/study-2026-11-18-0900.dump    # replaces all current data with that backup
```

`backups/` is not committed. Set `BACKUP_DIR` to write somewhere else, for example a synced folder. `pnpm restore` asks you to type "restore" first (`--yes` skips the question) and runs as one transaction, so a file that cannot be read leaves the current data untouched. Stop `pnpm dev` before restoring.

To move to a new machine: run `pnpm backup` on the old one, copy the `.dump` file and your lab repository across, then on the new one run `pnpm install`, `pnpm infra:up`, `pnpm restore <file>` and `pnpm dev`, and set the lab repository path again under Settings if it changed.

### Everything in Docker

```sh
pnpm full:up    # builds and starts the API, worker and web app as containers
pnpm bridge     # in a second terminal: the host bridge, needed to run task checks
```

The web app is then on http://localhost:8080. The curriculum is baked into the API image, so rebuild after changing content. `pnpm full:down` stops it.

## Studying

Open the web app and start with the Plan page. It lists the modules in order and points to what is next.

- **Lessons** end with "Mark as done", which adds the lesson's flashcards to your deck.
- **Review** shows the cards that are due. Scheduling uses FSRS, and the daily limits are on the Settings page.
- **Tasks** are either code tasks, checked automatically, or written tasks, reviewed by Claude against a rubric.
- **Search** finds a lesson or a task by a word in its title or text.
- **Stats** shows study time, streaks, lessons and tasks done, and how well you remember your cards.

### Working on code tasks

```sh
pnpm lab images                                       # once: build the images that run task checks
pnpm lab init ~/code/backend-lab                      # once: create your lab repository
pnpm lab start m00-foundations/t01-raw-http-server    # copy a task's starter files into it
```

Solve the task in the lab repository, commit, and press "Run checks" on the task page. The checks run against that commit inside a container with no internet access, no capabilities and a read-only file system.

Some modules need practice services. Start them with `pnpm lab up postgres` (also `valkey`, `aws`, `mailpit`). `pnpm lab status` shows what is running and `pnpm lab down` stops it. They are separate from the platform's own database, so an exercise can never touch your progress.

Run `pnpm lab images` again after pulling changes, because the packages available to task code are baked into the image.

### Claude review

Every task can be reviewed by Claude against its rubric, using your own Claude plan. No API key is involved.

- **Copy and paste** (the default): the task page builds a prompt. Paste it into Claude, then paste the reply back. For a code task, run it in Claude Code inside your lab repository so Claude can read the files.
- **One click** (turn it on under Settings): the host bridge runs the Claude CLI on your machine with read-only tools. It needs Claude Code installed and signed in.

## The curriculum

Twenty modules, in recommended order. Optional parts can be skipped without breaking later tasks.

| #   | Module                                                            | Practice services     |
| --- | ----------------------------------------------------------------- | --------------------- |
| 0   | Foundations: HTTP, the Node runtime, TypeScript for the backend   | none                  |
| 1   | Docker and Compose                                                | none                  |
| 2   | NestJS fundamentals                                               | none                  |
| 3   | PostgreSQL and data modelling                                     | `postgres`            |
| 4   | API design                                                        | `postgres`, `valkey`  |
| 5   | Testing                                                           | `postgres`            |
| 6   | Auth and security                                                 | `postgres`            |
| 7   | Caching and queues                                                | `valkey`              |
| 8   | Reliability patterns                                              | `postgres`            |
| 9   | File storage with S3                                              | `aws`                 |
| 10  | Payments with Stripe, transactional email, outbound webhooks      | `postgres`, `mailpit` |
| 11  | AWS building blocks                                               | `aws`                 |
| 12  | Observability                                                     | none                  |
| 13  | LLM features in a backend                                         | `postgres`            |
| 14  | CI/CD                                                             | none                  |
| 15  | Infrastructure as code                                            | none                  |
| 16  | Kubernetes (theory, with a section for practising on your own)    | none                  |
| 17  | Kafka and event streaming (theory, with the same kind of section) | none                  |
| 18  | System design and capstone                                        | most of the above     |
| 19  | Interview prep (optional)                                         | none                  |

`pnpm curriculum:check` validates every file under `curriculum/` and prints the number of lessons, tasks and cards per module.

## Not yet tested on a Mac

The platform was built and tested in a Linux environment. Three things could not be tested there and are worth a try on your machine:

- **One-click review with a real Claude login.** The flow was tested with a stand-in for the CLI. If the real CLI answers in a different shape, the task page shows the error and copy and paste still works.
- **Full Docker mode reaching the host bridge.** The containers call the bridge at `host.docker.internal`, which exists on Docker Desktop and OrbStack for macOS. If checks report that the bridge is not running while `pnpm bridge` is up, this is the place to look.
- **Module 15.** OpenTofu is not part of the platform, so its configuration files were written from the official documentation and never run. Its checks read the `.tf` files and do not run OpenTofu.

## Commands

| Command                           | What it does                                                         |
| --------------------------------- | -------------------------------------------------------------------- |
| `pnpm dev`                        | Start the database and all apps in watch mode                        |
| `pnpm full:up` / `pnpm full:down` | Run the API, worker and web app as containers                        |
| `pnpm bridge`                     | Run only the host bridge (for full Docker mode)                      |
| `pnpm backup` / `pnpm restore`    | Save the platform database to `backups/`, or load one backup back    |
| `pnpm lab <command>`              | Lab repository, check images and practice services (`pnpm lab help`) |
| `pnpm build`                      | Build every package                                                  |
| `pnpm typecheck`                  | Type-check every package                                             |
| `pnpm test`                       | Run tests (the API tests start PostgreSQL with Testcontainers)       |
| `pnpm lint` / `pnpm format`       | oxlint / Prettier                                                    |
| `pnpm curriculum:check`           | Validate every file under `curriculum/`                              |
| `pnpm db:generate`                | Generate a SQL migration after editing `packages/db/src/schema.ts`   |

## Layout

```
apps/api            NestJS HTTP API
apps/web            React SPA (Vite, TanStack Router and Query, Tailwind)
apps/worker         Runs queued check jobs and hands them to the bridge
apps/bridge         Host process that runs checks in sandbox containers and the Claude CLI
packages/shared     zod schemas shared by every app
packages/db         Drizzle schema, migrations and client
packages/curriculum Loads and validates the curriculum files
packages/lab-cli    The `pnpm lab` command
curriculum          Lessons, card decks and tasks, one folder per module
infra/compose       Docker Compose files: platform database, full mode, practice services
infra/docker        Images for the apps and for the check sandboxes
docs                Spec, stack decisions, decision log, security review, authoring guide, market research
```
