# Sandbox image for task checks.
#   docker build -t study-runner-node --target node infra/docker/runner
#   docker build -t study-runner-nest --target nest -f infra/docker/runner/Dockerfile infra/docker
# Build context is infra/docker so the nest stage can read runner-nest/package.json.

FROM node:24-alpine AS base
RUN addgroup -g 10001 runner && adduser -u 10001 -G runner -D -H runner \
 && mkdir -p /opt/runner /work /results /checks /submission
COPY runner/reporter.mjs runner/entrypoint.sh /opt/runner/
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["/opt/runner/entrypoint.sh"]

FROM base AS node

FROM base AS nest
USER root
COPY runner-nest/package.json runner-nest/package-lock.json /opt/runner/
# Internet is available while the image is built, never while it runs.
# npm ci installs exactly what the lockfile lists and checks every tarball's hash.
# --ignore-scripts: none of these packages needs an install script, so a hijacked one cannot run code here (S-007).
RUN cd /opt/runner && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
USER 10001:10001
