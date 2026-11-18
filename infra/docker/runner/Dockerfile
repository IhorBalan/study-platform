# Sandbox image for task checks.
#   docker build -t study-runner-node --target node infra/docker/runner
#   docker build -t study-runner-nest --target nest -f infra/docker/runner/Dockerfile infra/docker
# Build context is infra/docker so the nest stage can read runner-nest/package.json.

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS base
RUN addgroup -g 10001 runner && adduser -u 10001 -G runner -D -H runner \
 && mkdir -p /opt/runner /work /results /checks /submission
COPY runner/reporter.mjs runner/entrypoint.sh /opt/runner/
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["/opt/runner/entrypoint.sh"]

FROM base AS node

FROM base AS nest
USER root
COPY runner-nest/package.json /opt/runner/package.json
# Internet is available while the image is built, never while it runs.
RUN cd /opt/runner && npm install --omit=dev --no-audit --no-fund && npm cache clean --force
USER 10001:10001
