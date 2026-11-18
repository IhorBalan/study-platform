---
title: Compose for local development
skills: [compose, docker-networking, docker-storage]
---

Nobody wants to retype the `docker run` commands from the last lesson. A Compose file records them as YAML, one entry per container, and `docker compose up` makes reality match the file. It is the `package.json` scripts of your local infrastructure: checked in, reviewed, the same for everyone.

## Anatomy of a Compose file

Compose v2 is the `docker compose` subcommand (with a space). The file is `compose.yaml`, and the old top-level `version:` key is obsolete, so leave it out.

```yaml
name: shop

services:
  api:
    build: .
    environment:
      DATABASE_URL: postgres://shop:${DB_PASSWORD:?set DB_PASSWORD in .env}@db:5432/shop
    ports:
      - '127.0.0.1:${API_PORT:-3000}:3000'
    depends_on:
      db:
        condition: service_healthy
    networks: [edge, data]

  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: shop
      POSTGRES_DB: shop
      POSTGRES_PASSWORD: ${DB_PASSWORD:?set DB_PASSWORD in .env}
    volumes:
      - db-data:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U shop -d shop']
      interval: 2s
      timeout: 3s
      retries: 30
    networks: [data]

  adminer:
    image: adminer:5
    profiles: [admin]
    ports: ['127.0.0.1:8080:8080']
    networks: [edge, data]

networks:
  edge:
  data:
    internal: true

volumes:
  db-data:
```

Everything here is something you already know. `services` are containers, and each service name is a DNS name on the project's networks, which is why the API connects to `db:5432`. Top-level `volumes` and `networks` declare named volumes and networks. `name` prefixes every resource (`shop_db-data`), so two projects never collide.

## Start order and health

`depends_on: [db]` only waits for the database *container to start*. PostgreSQL needs a few more seconds before it accepts connections, and an API that connects at boot will crash in that gap. The long form with `condition: service_healthy` waits until the database's `healthcheck` passes. A third condition, `service_completed_successfully`, suits one-shot jobs such as migrations.

`docker compose up -d --wait` starts everything in the background and returns only when every service is running and, where a healthcheck exists, healthy. It exits non-zero if one fails, which makes it the right command for scripts and CI.

## Profiles

A service with `profiles` is ignored unless one of its profiles is active. Services without the key always start.

```sh
docker compose up -d --wait                   # api and db
docker compose --profile admin up -d --wait   # api, db and adminer
```

Use profiles for things only some people need some of the time: an admin UI, a tracing stack, a mock of a third-party API.

## Variables and env files

Two mechanisms share the word "env" and are easy to confuse:

- **Substitution in the file.** `${API_PORT:-3000}` is replaced when Compose reads the file, from your shell or from a `.env` file beside `compose.yaml`. `:-` gives a default; `:?` aborts with a message if the variable is missing. Use the second for secrets, so that no password is written in the file.
- **Variables inside the container.** Only `environment:` and `env_file:` put variables into a container. The `.env` file is not passed to containers automatically.

A literal dollar sign is written `$$`. Run `docker compose config` to print the file after substitution and catch mistakes before starting anything.

## The daily loop

```sh
docker compose up -d --wait
docker compose ps
docker compose logs -f api
docker compose exec db psql -U shop shop     # a shell command in a running service
docker compose run --rm api node dist/migrate.js   # a one-off container
docker compose down                          # remove containers and networks, keep volumes
```

For code inside containers, `docker compose watch` reads a `develop.watch` section and, when files change, either syncs them into the container or rebuilds the image. It avoids bind-mounting the whole project, which is slow on macOS:

```yaml
    develop:
      watch:
        - { action: sync, path: ./src, target: /app/src }
        - { action: rebuild, path: package.json }
```

## How this platform uses Compose

The platform you are studying on follows the same rules. Its core file, `infra/compose/compose.yaml`, contains exactly one service: PostgreSQL. It has a named volume, a `pg_isready` healthcheck, a memory limit and a port published as `127.0.0.1:${PLATFORM_DB_PORT:-54320}:5432`. The API and web app run directly on your Mac with hot reload, because rebuilding images on every save would be slower.

Practice services (a lab database, a cache, an AWS emulator, an observability stack) are opt-in. Each module declares the ones its tasks need, each sits behind its own profile, and `pnpm lab up <service>` activates it only when you ask. Your laptop pays in RAM only for what the current module uses.

## Common mistakes

- Short-form `depends_on` and an API that crashes because the database was not ready.
- A healthcheck that never passes (wrong user, missing tool in the image), so `--wait` hangs until it times out. Check `docker compose ps` and `docker inspect`.
- Using the published host port between services. Inside the network it is always the container port: `db:5432`, whatever the host mapping says.
- Unquoted port mappings. YAML can read `5432:5432`-style values as something other than a string, so quote them.
- Expecting `.env` values to appear inside containers without `environment` or `env_file`.
- Editing a Dockerfile and running `up` without `--build`, then testing the old image.
- `docker compose down -v` when you meant `down`.

## Go deeper

- [Compose file reference](https://docs.docker.com/reference/compose-file/): every key for services, networks, volumes and secrets.
- [Control startup order](https://docs.docker.com/compose/how-tos/startup-order/): `depends_on` conditions and healthchecks.
- [Using profiles](https://docs.docker.com/compose/how-tos/profiles/): activation rules and how profiles interact with `depends_on`.
- [Interpolation](https://docs.docker.com/reference/compose-file/interpolation/): the full `${VAR}` syntax with defaults and required values.
- [Compose Watch](https://docs.docker.com/compose/how-tos/file-watch/): `sync`, `rebuild` and `sync+restart` actions.
