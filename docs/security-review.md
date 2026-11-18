# Security review

Reviewed on 2026-11-18 against `claude/project-thread-udr6y6` at `528226a` (PR #1). Fixes are in the security PR from `claude/project-thread-hgkmuk`; decisions are logged in [`security-decisions.md`](./security-decisions.md).

## Verdict

**No sign of compromise.** No committed secrets in any branch's history, no known malicious or typosquatted package, no git or tarball dependencies, every lockfile entry carries an integrity hash, and the installed tree contains none of the known worm indicators (Shai-Hulud `setup_bun.js` / `bun_environment.js`, trufflehog payloads, the September 2025 `chalk`/`debug` hijack versions).

The real risks are in the **design of the parts not built yet** (host bridge, Claude CLI runs, Lambda emulator with the Docker socket) and in a few **supply-chain settings** that are looser than they need to be.

## Findings by severity

### High

**H1 · The Lambda emulator's Docker socket is reachable from the sandbox network.** The `lambda` profile gives Floci the Docker socket, and Floci sits on `lab-net`, which is the network every check sandbox joins. Anything that can reach Floci's unauthenticated API on port 4566 can ask it to start containers, and any bug in a young (2026) emulator that holds the socket is root on the Docker host. On macOS that host is the Docker Desktop VM, which mounts `/Users`, so the home directory (SSH keys, `~/.claude`, `~/.aws`) is in reach.
*Fix (design, before the `lambda` profile is built):* see S-010. Give Floci a filtering socket proxy that refuses bind mounts, privileged mode and host networking; put it on its own `lab-lambda-net` that only Lambda tasks join; pin the Floci image by digest.

**H2 · Claude CLI runs inside learner-controlled folders.** One-click review runs `claude -p` with the exported task folder as the working directory. A `.claude/settings.json` (hooks run shell commands), `.mcp.json` (starts MCP servers) or `CLAUDE.md` in that folder is loaded by the CLI on the host, outside any sandbox. "Read-only tools" alone does not stop hooks. Today the learner is the only author, so this is an accident and prompt-injection risk rather than an attack, but lesson content and copied example code will flow through it.
*Fix (design, bridge step):* see S-011. Run with `--setting-sources user`, `--strict-mcp-config` with an empty config, an explicit `--allowedTools "Read,Grep,Glob"` plus `--disallowedTools "Bash,Edit,Write,WebFetch,WebSearch"`, never `--dangerously-skip-permissions`, and strip `.claude/`, `.mcp.json` and `CLAUDE.md` from the export.

### Medium

**M1 · The cooldown on new npm releases was bypassed for 12 packages.** `pnpm-workspace.yaml` excluded `vitest@5.1.1`, `turbo@2.11.12`, `@tanstack/react-query@5.108.0` and their sub-packages from pnpm's release-age check. They were published 3 to 21 hours before they were installed, which is exactly the window in which hijacked releases are found and pulled. I checked them: all twelve have SLSA provenance from their projects' CI and none has an install script, so they look genuine. *Fixed:* the policy is now explicit, the exclusions are marked temporary, and they can be removed after 2026-11-19 08:00 UTC (S-001, S-002).

**M2 · The `nest` runner image installed packages without a lockfile, as root, with install scripts on.** Every image build could resolve different versions. *Fixed:* added `infra/docker/runner-nest/package-lock.json` (135 packages, all from the npm registry, none with install scripts, 0 advisories) and switched to `npm ci --ignore-scripts` (S-007).

**M3 · GitHub Actions were pinned by tag, and checkout left the token on disk.** Tags can be moved (as in the `tj-actions/changed-files` incident). *Fixed:* all actions pinned to full commit SHAs, `persist-credentials: false`, and a `supply-chain` job that enforces the lockfile policy and fails on new high or critical advisories (S-008, S-009).

**M4 · Bridge request handling needs strict input rules.** The bridge will turn `{ taskId, folder, commitSha }` into `git archive` and `docker run` commands. Without validation that is argument injection (`--output=…`, `--exec=…`) and path traversal. *Fix (design):* S-012: `execFile` with argument arrays only, `commitSha` must match `^[0-9a-f]{40}$`, folder must resolve inside the lab repo, `--` before paths, constant-time secret comparison, reject any request with an `Origin` header, and check `Host` is `127.0.0.1` or `localhost` (DNS rebinding).

### Low

- **L1 · `npm audit`: 4 moderate, 1 high, all in dev tooling.** `picomatch` ReDoS (high, no fixed version, reached only through Vite, Vitest and unplugin with our own globs; accepted, S-005); `esbuild` 0.18 dev-server CORS (via deprecated `@esbuild-kit/*` in `drizzle-kit` 0.31; we never run that dev server); `glob`, `minimatch` (via `testcontainers` → `archiver`) and `postcss-selector-parser` (via `@tailwindcss/typography`) DoS issues on input we control. None ships to the browser or runs on untrusted input. Clear them by upgrading the parents when fixed versions land.
- **L2 · Base images are pinned by tag, not digest** (`node:24-alpine`, `postgres:18-alpine`). Recommend `@sha256:` digests plus a monthly bump; Docker Hub rate-limited me, so this PR does not add them (S-013).
- **L3 · The API has no `Host` check.** It binds to 127.0.0.1 and CORS blocks other sites' `PUT`/`PATCH`/`DELETE` and JSON bodies, so cross-site writes do not work today, but a DNS-rebinding page could read data. Worth adding once the API can trigger bridge runs.
- **L4 · `@nestjs/core` was on the build-script allow-list** but has no install script. An entry with nothing to build only leaves room for a future malicious one. *Fixed:* removed.
- **L5 · A stray TanStack temp file is committed** (`apps/web/.tanstack/tmp/…`). Harmless. *Fixed:* removed and `.tanstack/` ignored.

### Checked and fine

- **Secrets:** full history of every branch scanned for AWS, Anthropic, Stripe, GitHub, Slack and private-key patterns; nothing. `.env` is ignored; `.env.example` has only local defaults.
- **Packages:** 639 package names reviewed for typosquats and known-bad versions. `debug` is 4.4.3 and `ansi-*`, `strip-ansi`, `wrap-ansi`, `color-*` are outside the hijacked versions. Very old packages (`once`, `inherits`, `escape-html` and similar) are finished single-purpose utilities from long-standing maintainers, not abandoned risks.
- **Install scripts:** only `esbuild`, `@swc/core` (both allow-listed), `protobufjs`, `ssh2` and `cpu-features` (all three blocked) have them. `strictDepBuilds` now fails any new one.
- **Lockfile:** every entry from `registry.npmjs.org` with an integrity hash; `--frozen-lockfile` install verified.
- **Sandbox `docker run`:** cap-drop ALL, no-new-privileges, read-only root, non-root user, memory, CPU, PID and time limits, internal network. Good. Suggested additions: `--network none` for tasks that need no service, `--tmpfs /tmp:rw,noexec,nosuid,size=64m`, and `--ulimit nofile=1024`.
- **Web:** `react-markdown` without `rehype-raw`, so lesson Markdown cannot inject HTML. Vite binds to 127.0.0.1.
- **CI permissions:** already `contents: read`, no `pull_request_target`, no secrets used.

## Re-check routine

Run on every dependency change (the `supply-chain` CI job does the first two):

1. `pnpm install --frozen-lockfile --ignore-scripts` passes the workspace policies.
2. `pnpm audit --audit-level high` and `npm audit --package-lock-only` in `infra/docker/runner-nest`.
3. New packages: check the name for typosquats, publisher and provenance (`npm view <pkg> dist.attestations`), and any install script before adding it to `allowBuilds`.
4. Remove `minimumReleaseAgeExclude` entries once the versions are older than the window.
