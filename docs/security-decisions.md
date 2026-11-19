# Security decision log

Security decisions, in the same format as [`decisions.md`](./decisions.md). They live in their own file so the security thread and the build thread do not edit the same lines. Findings and evidence are in [`security-review.md`](./security-review.md).

Status values: **Accepted** (in use), **Proposed** (a design rule for code not written yet), **Temporary** (has an expiry), **Superseded**.

---

## Dependencies and supply chain

### S-001 · State the npm release-age policy explicitly: 1 day — Accepted, 2026-11-18
- **Chosen:** `minimumReleaseAge: 1440` in `pnpm-workspace.yaml`. pnpm 11 already applied a check, but nothing in the repo said what it was.
- **Why:** most hijacked npm releases (the 2025 `chalk`/`debug` hijack, Shai-Hulud, `nx`) were found and removed within hours. Waiting a day avoids most of them.
- **Alternatives:** 3 days (`4320`). I tried it: today's lockfile has 30+ packages younger than that, so it would block the build thread's work.
- **Revisit:** raise to 3 days once the stack settles and versions change less often.

### S-002 · Release-age exclusions are temporary and must be removed — Superseded by D-109, 2026-11-19
- **Context:** the build excluded `vitest@5.1.1`, `turbo@2.11.12`, `@tanstack/react-query@5.108.0` and their sub-packages, published 3 to 21 hours before install.
- **Checked:** all twelve have SLSA provenance from their projects' CI and no install scripts, so they are kept.
- **Rule:** an exclusion needs a reason here and is removed as soon as the version is older than the window. These can all go after 2026-11-19 08:00 UTC.
- **Revisit:** if exclusions keep appearing, pin the previous version instead of excluding the new one.
- **Outcome:** the build thread removed every exclusion on 2026-11-18 and pinned `turbo` 2.11.11 and `vitest` 5.1.0 instead. The rule is now "no exclusions at all" (D-109).

### S-003 · `trustPolicy: no-downgrade` and `blockExoticSubdeps: true` — Accepted, 2026-11-18
- **Why:** refuses a version published with weaker evidence (no provenance or trusted publisher) than earlier versions of the same package, which is the usual signature of a stolen token. Blocks transitive dependencies from git URLs or tarballs, which skip registry checks.
- **Checked:** the current lockfile passes both.

### S-004 · `strictDepBuilds: true`, and only packages that build are allow-listed — Accepted, 2026-11-18
- **Why:** install scripts are how most npm malware runs. With this setting a new package that wants one fails the install until someone looks at it.
- **Changed:** removed `@nestjs/core` from `allowBuilds`; it has no install script.
- **Allowed:** `esbuild`, `@swc/core` (download a native binary). **Blocked:** `cpu-features`, `ssh2`, `protobufjs` (optional, not needed).

### S-005 · Accept the `picomatch` ReDoS advisory (GHSA-fc5q-39xc-vjpf) — Accepted, 2026-11-18
- **Why:** there is no fixed version, and it is only reached by Vite, Vitest and unplugin evaluating globs we write. It never sees untrusted input and does not ship.
- **How:** `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, so the CI audit still fails on anything new.
- **Revisit:** drop the ignore when picomatch publishes a fix.

### S-006 · Moderate dev-only advisories are tracked, not blocked — Accepted, 2026-11-18
- **What:** `esbuild` 0.18 (via `drizzle-kit`), `glob` and `minimatch` (via `testcontainers`), `postcss-selector-parser` (via `@tailwindcss/typography`).
- **Why:** dev tooling on our own input. CI fails on high and critical only.

### S-007 · The `nest` runner image installs from a lockfile with scripts off — Accepted, 2026-11-18
- **Chosen:** commit `infra/docker/runner-nest/package-lock.json` and run `npm ci --omit=dev --ignore-scripts`.
- **Why:** before, every image build resolved fresh versions as root with install scripts enabled. None of the 135 packages needs a script.
- **Consequence:** changing the runner's packages now means running `npm install --package-lock-only --ignore-scripts` in that folder and committing the lockfile.

## CI

### S-008 · Pin GitHub Actions to commit SHAs and drop the checkout token — Accepted, 2026-11-18
- **Why:** a tag can be moved to new code (the 2025 `tj-actions/changed-files` compromise did this); a SHA cannot. `persist-credentials: false` keeps the job token off disk, since no step pushes.
- **Pinned:** `actions/checkout` v5.1.0, `pnpm/action-setup` v4.3.0, `actions/setup-node` v5.0.0, the same majors as before.
- **Revisit:** add Dependabot for `github-actions` once the repo has a `main` branch, so pins are bumped automatically. It is not added now because it would open PRs against the handoff branch.

### S-009 · A `supply-chain` CI job — Accepted, 2026-11-18
- **What:** installs with scripts off (which enforces S-001 to S-004 against the lockfile), then `pnpm audit --audit-level high` and an audit of the runner lockfile.
- **Why:** catches a policy-breaking lockfile or a new serious advisory on every PR, including the build thread's.

## Sandbox, bridge and Claude CLI (design rules for steps not built yet)

### S-010 · The Lambda emulator never gets the raw Docker socket — Accepted for now (no Lambda profile exists), 2026-11-19
- **Rule:** in the `lambda` profile, Floci talks to Docker through a filtering socket proxy (for example `wollomatic/socket-proxy` with an allow-list) that refuses bind mounts, `privileged`, host networking and added capabilities. Floci joins a separate `lab-lambda-net` that only Lambda tasks' sandboxes join. The Floci image is pinned by digest.
- **Why:** the sandboxes' network reaches Floci's unauthenticated API, and whoever controls a raw socket is root on the Docker host, which on macOS mounts `/Users`.
- **Alternatives:** Docker-in-Docker (needs `privileged`, same problem); no Lambda practice (loses a core topic); run Lambda through the bridge (more bridge code).
- **Status 2026-11-19:** the lab Floci service has no Docker socket and Lambda is taught without it. This rule applies if a Lambda profile is ever added.

### S-011 · How the bridge runs the Claude CLI — Accepted, implemented 2026-11-18 (D-100)
- **Rule:** `claude -p` with `--setting-sources user`, `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`, `--allowedTools "Read,Grep,Glob"`, `--disallowedTools "Bash,Edit,Write,WebFetch,WebSearch"`, the export directory as the only working directory, and never `--dangerously-skip-permissions`. Strip `.claude/`, `.mcp.json` and `CLAUDE.md` from the export before the run.
- **Why:** in non-interactive mode the CLI loads project settings from the working directory without asking. Hooks in `.claude/settings.json` run shell commands on the host, outside the sandbox.

### S-012 · Bridge input and transport rules — Accepted, implemented 2026-11-18 (D-095)
- **Rule:** spawn processes with `execFile` and argument arrays, never a shell. `commitSha` must match `^[0-9a-f]{40}$`; the folder must resolve inside the lab repo; put `--` before paths. Compare the shared secret with `crypto.timingSafeEqual`. Reject requests that carry an `Origin` header, and requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`. Generate the secret on first run instead of shipping `change-me`.
- **Why:** blocks argument injection into `git archive` and `docker run`, path traversal, timing attacks on the secret, and browser-based DNS-rebinding requests.

### S-013 · Pin container images by digest — Accepted, implemented 2026-11-18 (D-105)
- **Rule:** `node:24-alpine@sha256:…`, `postgres:18-alpine@sha256:…`, and the same for every lab image, bumped deliberately.
- **Why:** a tag can point at a different image tomorrow. Not done in this PR because Docker Hub rate-limited the digest lookup.

## Re-checks

### S-014 · The runner image's npm lockfile gets the same release-age rule — Accepted, 2026-11-19
- **Found by:** the 2026-11-19 re-check. The `nest` runner lockfile grew from 135 to 286 packages (AWS SDK, AI SDK, Stripe, BullMQ, OpenTelemetry and others). pnpm's `minimumReleaseAge` does not apply to it, and `standardwebhooks@1.3.0` was about 19 hours old when it was locked.
- **Checked:** all 152 new runner packages and 20 new workspace packages come from the npm registry with integrity hashes, the young ones (`bullmq`, `hono`, `@hono/node-server`, `@anthropic-ai/sdk`, `@smithy/core`, `standardwebhooks`) all have SLSA provenance from their projects' CI, no names look like typosquats, and both audits report nothing new. The only new install script (`msgpackr-extract`) is an optional native speed-up that `--ignore-scripts` skips.
- **Chosen:** `scripts/check-npm-lock.mjs`, run in the `supply-chain` CI job. It fails when an entry is not from the npm registry, has no integrity hash, or is younger than 24 hours.
- **Alternatives:** install the runner packages with pnpm (would need a second pnpm project inside the image); npm's own release-age option (not available in the npm that ships with Node 24).

### S-015 · Re-check findings that need no change — 2026-11-19
- **Deprecated, not risky:** `prom-client` (renamed to `@prometheus-io/client`), `@opentelemetry/sdk-trace-base` and `-node` (merged into `@opentelemetry/sdk-trace`), `node-abort-controller`. Worth moving when those lessons are next edited, so learners meet the current names.
- **Bridge spot check:** processes start without a shell, the commit is resolved to a full hex id, the secret comparison is constant-time, `Host` and `Origin` are checked, and the Claude CLI flags and stripped files match S-011.
- **Low, accepted:** the bridge runs `git` inside the learner's lab repository, so that repository's `.git/config` is honoured. The commands used (`rev-parse`, `cat-file`, `archive`) do not run configured hooks or `fsmonitor`, and the learner is the only author.
