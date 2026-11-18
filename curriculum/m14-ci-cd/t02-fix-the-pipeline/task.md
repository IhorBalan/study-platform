The workflow in `.github/workflows/ci.yml` builds and publishes the `shop-api` image. It starts nine jobs for every pull request, it once let a failing test reach `main`, and a security review flagged it. Fix it without changing what it is for.

## Requirements

Keep two jobs, `verify` and `image`.

**Safety**

- Trigger on `pull_request` and on `push` to `main` only. Do not use `pull_request_target`.
- Workflow-level `permissions: contents: read`. The `image` job gets `contents: read` and `packages: write` and nothing else. `verify` gets no write scope.
- Pin every action to a full commit SHA, with the version in a comment.
- No `${{ github.event.* }}`, `${{ github.head_ref }}` or `${{ secrets.* }}` inside a `run:` script. Pass values through `env:` instead. Log in to the registry with `docker/login-action` and `${{ secrets.GITHUB_TOKEN }}`.

**Correctness**

- A failing lint, typecheck, test or build must fail the run: no `continue-on-error`, no `|| true`.
- Install with `pnpm install --frozen-lockfile`.

**Speed**

- Production runs on Linux with Node 24, and the team tests Node 26 ahead of the upgrade. `verify` runs on `ubuntu-latest` only, for Node 24 and 26.
- pnpm comes from `pnpm/action-setup` and its store is cached.
- A workflow-level concurrency group that includes `github.ref` cancels superseded runs.
- Both jobs have `timeout-minutes` of 30 or less.

**The image**

- `image` runs only after `verify` succeeds (`needs`), and only on a push to `main` (`if:` on `github.event_name` and `github.ref`).
- It uses `docker/build-push-action` and tags the image `ghcr.io/${{ github.repository }}:${{ github.sha }}`. A second, moving tag is fine.
- It uses the GitHub Actions build cache: `cache-from: type=gha` and `cache-to: type=gha,mode=max`.

## Submission

The project with your fixed `ci.yml`. In `README.md`, list each change in one line: what was wrong, and why the new version is better.

## What is checked

The checks read `ci.yml` as YAML and test every requirement above. They do not run the workflow. The review reads your README for the reasoning, especially what an attacker could have done with the old workflow.
