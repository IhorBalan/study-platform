# syntax=docker/dockerfile:1

# ---- build: has npm, the build script and the sources -----------------------
FROM node:24-trixie-slim AS build
WORKDIR /app

# Manifest first, so this layer and the install below stay cached until it changes.
# (Use `npm ci` once a lockfile is committed.)
COPY package.json ./
RUN npm install

COPY scripts ./scripts
COPY src ./src
RUN npm run build

# ---- runtime: only what the process needs ------------------------------------
FROM node:24-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/server.js"]
