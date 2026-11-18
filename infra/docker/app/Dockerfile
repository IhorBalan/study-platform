# Images for full mode: API, worker and web. Build context is the repository root.
#   docker compose -f infra/compose/full.compose.yaml up --build
# The host bridge is never containerised: it is the only process allowed to use Docker.

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
# Manifests first, so the dependency layer is reused until a manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/bridge/package.json apps/bridge/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/curriculum/package.json packages/curriculum/
COPY packages/lab-cli/package.json packages/lab-cli/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# Self-contained folders with production dependencies only.
RUN pnpm --filter @study/api deploy --prod --legacy /out/api \
 && pnpm --filter @study/worker deploy --prod --legacy /out/worker

FROM node:24-alpine AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 CURRICULUM_DIR=/curriculum
WORKDIR /app
COPY --from=build /out/api ./
COPY curriculum /curriculum
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM node:24-alpine AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/worker ./
USER node
CMD ["node", "dist/main.js"]

FROM nginxinc/nginx-unprivileged:1.29-alpine AS web
COPY infra/docker/app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
