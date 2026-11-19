---
title: Writing good Dockerfiles
skills: [dockerfile, docker-images]
---

A Dockerfile that merely works is easy to write: copy everything, install, run. A good one rebuilds in seconds after a code change, ships only what production needs, runs without root and shuts down cleanly. This lesson builds one for a Node and TypeScript service that uses pnpm.

## Order instructions for cache hits

The builder reuses a layer only while nothing before it has changed. Source code changes on every commit, the lockfile changes rarely, so copy the lockfile and install first, then copy the source. With `COPY . .` before the install, every edit to any file reinstalls every dependency.

A `.dockerignore` file next to the Dockerfile decides what is sent to the builder at all. Without it, `COPY . .` drags in your host `node_modules` (built for macOS, not Linux), the `.git` folder and any local `.env` file:

```text
node_modules
dist
.git
.env*
*.log
```

## Multi-stage builds

Building needs the TypeScript compiler and dev dependencies. Running needs neither. A multi-stage Dockerfile has several `FROM` lines; each starts a fresh stage, and `COPY --from=<stage>` moves chosen files between them. Only the last stage becomes the image.

```dockerfile
# syntax=docker/dockerfile:1

FROM node:24-trixie-slim AS base
WORKDIR /app
RUN npm install -g pnpm@11 && pnpm config set --global store-dir /pnpm/store

# All dependencies, cached until the manifest or lockfile changes
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Compile TypeScript to dist/
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Production dependencies only
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# The image that ships: no pnpm, no compiler, no sources
FROM node:24-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
```

What to notice:

- **Pinned base.** `node:24-trixie-slim` names the Node major, the Debian release and the slim variant. A bare `node` or `node:latest` changes under you. For byte-for-byte reproducibility append the digest: `node:24-trixie-slim@sha256:…`.
- **Cache mount.** `--mount=type=cache` keeps pnpm's package store between builds without putting it in a layer, so even a lockfile change downloads only what is new.
- **`--frozen-lockfile`** fails the build if the lockfile and `package.json` disagree, instead of silently resolving new versions.
- **Non-root.** The official Node images include an unprivileged `node` user. Files copied in are owned by root and readable by everyone, so the process can read its code but cannot modify it. If the app must write somewhere, use `COPY --chown=node:node` for that path or mount a volume.
- **Size.** The full `node:24` image is around a gigabyte because it carries compilers and build tools. The slim variant is a fraction of that. Alpine is smaller still but uses musl instead of glibc, which occasionally breaks native modules.

## ENTRYPOINT, CMD and PID 1

`ENTRYPOINT` is the executable, `CMD` is its default arguments. With only `CMD`, it is the whole command. Arguments after the image name in `docker run` replace `CMD` and keep `ENTRYPOINT`.

Both accept two forms, and the difference matters:

```dockerfile
CMD ["node", "dist/main.js"]   # exec form: node is PID 1
CMD node dist/main.js          # shell form: /bin/sh -c "…" is PID 1
```

`docker stop` sends SIGTERM to PID 1 only. In shell form that is a shell, which typically does not pass the signal on, so your server never hears it and is killed ten seconds later with requests in flight. `CMD ["pnpm", "start"]` has the same flaw with a package manager in the way. Use the exec form and start `node` directly.

PID 1 has one more quirk: the kernel does not apply default signal actions to it. A Node process with no SIGTERM handler ignores the signal when it is PID 1. Handle it yourself:

```ts
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
```

Alternatively, `docker run --init` (or `init: true` in Compose) inserts a tiny init process that forwards signals and reaps zombie processes.

## HEALTHCHECK

`HEALTHCHECK` runs a command inside the container on a timer; exit code 0 means healthy. Docker shows the result in `docker ps`, and Compose can wait for it before starting dependent services (lesson 4). Slim images have no `curl`, so the example uses Node's built-in `fetch`. Orchestrators such as Kubernetes ignore this instruction and use their own probes, so the endpoint matters more than the instruction.

## Common mistakes

- `COPY . .` before installing dependencies, which defeats the cache.
- No `.dockerignore`, so host `node_modules`, `.git` and secrets end up in the build context or the image.
- Passing a secret through `ARG` or `ENV`. Both are stored in the image metadata and history. Use `RUN --mount=type=secret` for build-time secrets.
- Shell-form `CMD`, or starting through `npm`/`pnpm`, so SIGTERM never reaches the app.
- Shipping the build stage: dev dependencies and the compiler in production.
- Running as root because "it is only a container". A process that escapes as root is root on the host kernel.

## Go deeper

- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/): every instruction, including exec and shell forms and how `ENTRYPOINT` and `CMD` combine.
- [Building best practices](https://docs.docker.com/build/building/best-practices/): Docker's own checklist for base images, ordering and `.dockerignore`.
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/): naming stages, copying between them and building one target.
- [Optimize cache usage in builds](https://docs.docker.com/build/cache/optimize/): cache mounts, bind mounts and layer ordering.
- [Build secrets](https://docs.docker.com/build/building/secrets/): how to use a token during a build without storing it in the image.
