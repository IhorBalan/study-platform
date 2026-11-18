---
title: What CI is for and the shape of a good pipeline
skills: [ci-pipeline-design]
---

Continuous integration is often described as "a server that runs the tests". That is the tool, not the point. The point is that everyone merges small changes into one main branch often, and every merge is checked automatically, so that `main` is always in a state you could ship. A good pipeline is the thing that makes that safe. It is judged by two numbers: how fast it tells you something is wrong, and how often you can believe it.

## What CI buys you

On the frontend you have probably had Vercel or Netlify build every pull request. That is CI in its most visible form: a clean machine checks out the code, installs exactly what the lockfile says, and runs the same commands every time. Three things follow from that.

- **Integration problems surface while they are small.** Two people changing the same module find out within hours, not at the end of a two-week branch.
- **"Done" gets a definition.** A change is done when the pipeline is green on it, not when it works on someone's laptop with a stale `node_modules` and a local database that has a column production does not.
- **Releasing becomes boring.** If `main` is always green, any commit on it can be deployed, which is what continuous delivery builds on (lesson 5).

A backend pipeline checks more than a frontend one usually does: database migrations, integration tests against a real Postgres, a container image that has to start. The ideas are the same.

## Fast feedback: order the stages by cost

Developers stop waiting for a pipeline that takes 25 minutes. They context-switch, stack more changes on top, and merge on "it was probably fine". Martin Fowler's long-standing target is about ten minutes for the main build; for a small API, three to six minutes is realistic.

Order the work so the cheapest checks fail first:

| Stage | Typical time | Catches |
| --- | --- | --- |
| Install with a frozen lockfile | 10–40 s with a cache | Lockfile out of step with `package.json` |
| Format and lint | 5–30 s | Style, unused code, banned patterns |
| Typecheck | 10–60 s | Most refactoring mistakes |
| Unit tests | 10–60 s | Logic errors |
| Integration tests (real Postgres) | 30 s – 3 min | SQL, migrations, wiring |
| Build | 10–60 s | Compiler settings that typecheck alone misses |
| Container image | 1–4 min | Dockerfile errors, missing files at runtime |

"Fail fast" means a typo stops the run in 20 seconds instead of after the slow integration suite. It does not mean "stop at the first failing test"; inside one stage you want every failure listed, so one run tells you everything that is broken.

### One job or several?

Each job runs on a fresh machine and pays for checkout and install again. For a small project one job with sequential steps is often fastest overall. Once the suite is slow, split it: lint and typecheck in one job, tests in another, both in parallel, with the image job waiting for both. Measure before splitting; parallelism you pay for in install time is not free.

## Caching: speed without lying

Most of a cold run is spent downloading packages. Cache the package manager's store, keyed by a hash of the lockfile, so the cache is reused while dependencies are unchanged and rebuilt when they change. With pnpm that is the content-addressed store, not `node_modules`.

A cache must never change the result. Two rules keep it honest:

- **The key includes everything that affects the content**: lockfile hash, OS, and the Node major if native modules are involved.
- **Install still runs**, with `--frozen-lockfile`. The cache only saves downloads; the lockfile decides what is installed.

Build caches (TypeScript's incremental info, Docker layers) follow the same idea. Lesson 3 covers the Docker layer cache.

## Required checks: green must mean mergeable

A pipeline that can be ignored will be. In GitHub, a branch ruleset (or the older branch protection) on `main` makes named checks required: a pull request cannot merge until they pass. Three details matter:

- **Require the check by its job name**, and keep that name stable. Renaming a job silently drops it from the required list.
- **Require the branch to be up to date**, or use a merge queue, if two green pull requests can break each other. Otherwise `main` is only checked after the merge, which is why pipelines also run on `push` to `main`.
- **Flaky tests are a pipeline bug.** A test that fails one run in twenty teaches everyone to press "re-run" without reading. Fix it or quarantine it the same day; module 5 covers the usual causes.

## Trunk-based flow

The branching model decides how much integration happens at all. In trunk-based development everyone works on short-lived branches (hours to a couple of days), merges into `main` through a reviewed pull request, and `main` stays releasable. Work that is not finished is merged anyway, hidden behind a feature flag or not yet wired to a route.

Compare that with a long-lived `develop` branch and release branches. Each extra branch is a place where code is not integrated, and the merge at the end is where the surprises are. For a small team, trunk-based development with required checks is the simple default.

## A real example: this repository's workflow

The platform you are using has its own CI at `.github/workflows/ci.yml`:

```yaml
on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm test
```

Read it against this lesson. It runs on pull requests and again on `main` after a merge. A new push cancels the run it replaces. The token is read-only. Node comes from `.nvmrc`, so CI and laptops agree. The pnpm store is cached and the install is frozen. Cheap checks run first. `build` comes before `typecheck` here because the workspace packages are typechecked against each other's compiled output. That is a project-specific reason, and a good pipeline has a reason for every step it reorders.

What would you change? The actions are pinned to tags, which can move. Lesson 2 explains why pinning to a commit SHA is safer, and task 1 asks you to do it.

## Common mistakes

- A pipeline that runs only on pull requests, so nothing checks `main` after two changes that each passed alone are merged together.
- Optimising the slow integration tests while lint and typecheck still run after them.
- Caching `node_modules` with a key that ignores the lockfile, so a stale tree makes a run green that should be red.
- Checks that run but are not required, so red pull requests get merged on a deadline.
- Treating a flaky test as noise. It trains everyone to ignore failures, including real ones.
- Long-lived feature branches with CI on them, called "CI". Running tests on an isolated branch is not integration.

## Go deeper

- [Continuous Integration (Martin Fowler)](https://martinfowler.com/articles/continuousIntegration.html): the practices behind CI, including the ten-minute build and fixing the build first.
- [Trunk Based Development](https://trunkbaseddevelopment.com/): the branching model and how teams of different sizes apply it.
- [About rulesets (GitHub Docs)](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets): how to protect `main` and require checks.
- [DORA software delivery metrics](https://dora.dev/guides/dora-metrics/): lead time, deployment frequency, change fail rate and recovery time, the numbers a pipeline should improve.
