---
title: Networks, volumes and configuration
skills: [docker-networking, docker-storage, container-config, container-hardening]
---

An image says what runs. The flags you pass at run time say what the container can reach, where its data lives, how it is configured and how much damage it can do. This lesson covers those four areas with plain `docker run`; the next lesson writes the same things down in Compose.

## Networks and DNS

Each container gets its own network namespace, so `localhost` inside a container is that container and nothing else. Containers talk to each other over a Docker network.

On a **user-defined bridge network** Docker runs a small DNS server, and every container can be reached by its name:

```sh
docker network create shop-net
docker run -d --name db --network shop-net -e POSTGRES_PASSWORD=dev postgres:18-alpine
docker run --rm --network shop-net postgres:18-alpine pg_isready -h db -p 5432
# db:5432 - accepting connections
```

The API's connection string is therefore `postgres://…@db:5432/…`, never `localhost`. The default network called `bridge` has no name resolution, which is one reason to always create your own. Compose creates one per project and uses service names as host names.

## Publishing ports

Containers on the same network reach each other on any port without publishing anything. Publishing is only for traffic from the host:

```sh
docker run -p 8080:3000 my-api             # host port 8080 on ALL interfaces
docker run -p 127.0.0.1:8080:3000 my-api   # host port 8080 on loopback only
```

The first form listens on `0.0.0.0`, so anyone on the same Wi-Fi can reach it, and on Linux Docker's own firewall rules bypass tools such as `ufw`. For local development, always write the `127.0.0.1:` prefix. The order is `host:container`.

A network created with `--internal` has no route to the outside world. Put a database on an internal network and attach the API to both that network and a normal one: the API can reach the database, the database cannot call out, and a port published on a container that sits only on an internal network does not work, so it cannot be exposed by accident.

## Volumes and bind mounts

| | Named volume | Bind mount |
| --- | --- | --- |
| Syntax | `-v pgdata:/var/lib/postgresql` | `-v "$PWD/config:/etc/app:ro"` |
| Lives | In Docker's storage (inside the VM on macOS) | At a path on your machine |
| Use for | Database files, anything the container owns | Source code and config you edit on the host |

A named volume outlives its containers. `docker rm`, `docker compose stop` and `docker compose down` all leave it alone. `docker compose down -v` deletes the named volumes declared in the Compose file, and with them your database. There is no undo.

A bind mount gives the container your real files. Add `:ro` unless the container must write to them. On macOS bind mounts cross the VM boundary and are slower than volumes.

Check where an image expects its data. PostgreSQL 18 images keep it under `/var/lib/postgresql`; earlier majors used `/var/lib/postgresql/data`. Mount the wrong path and the data lands in the container's writable layer, where it dies with the container.

## Environment variables and secrets

Configuration that differs between environments goes in environment variables: `-e LOG_LEVEL=debug` or `--env-file .env`. They are convenient and not private. Anyone who can run `docker inspect` sees them, every child process inherits them, and crash reports like to print them.

For real secrets prefer a file. Compose and Swarm mount each secret at `/run/secrets/<name>`, and many official images accept a `_FILE` variant such as `POSTGRES_PASSWORD_FILE`. On a laptop a git-ignored `.env` file is an acceptable compromise. A password committed in a Compose file or baked into an image is not.

## Resource limits and hardening

By default a container may use all the memory and CPU of the host (on macOS, of the VM) and holds more privileges than a web service needs. A hardened run looks like this:

```sh
docker run -d --name api \
  --memory 512m --cpus 1 --pids-limit 200 \
  --cap-drop ALL --security-opt no-new-privileges \
  --read-only --tmpfs /tmp \
  --user 10001:10001 \
  --network shop-net -p 127.0.0.1:8080:3000 \
  my-api:1.4.2
```

- `--memory` is a hard cap. A process that exceeds it is killed by the kernel, and the container exits with code 137.
- `--cpus 1` allows at most one core's worth of CPU time. `--pids-limit` stops a fork bomb or a runaway worker pool.
- `--cap-drop ALL` removes Linux capabilities, the pieces that root's power is divided into. A service listening on a port above 1023 needs none of them.
- `--security-opt no-new-privileges` stops the process gaining privileges later through setuid binaries.
- `--read-only` makes the image's filesystem immutable. `--tmpfs /tmp` gives back an in-memory scratch directory. Volumes stay writable.
- `--user` overrides the image's user with a numeric, non-root UID.

All flags go before the image name. Anything after it is passed to the container as its command.

## Common mistakes

- Connecting to `localhost:5432` from one container to reach another. Use the service or container name.
- Publishing a database with `-p 5432:5432` and exposing it to the whole network.
- Running `docker compose down -v` to "restart cleanly" and deleting the database.
- Mounting a volume at a path the image does not use for its data.
- Hard-coding passwords in a Compose file or a Dockerfile `ENV`.
- Setting `--memory` above what the macOS VM has, then wondering why the container is still killed.

## Go deeper

- [Networking overview](https://docs.docker.com/engine/network/): how containers connect and how port publishing works.
- [Bridge network driver](https://docs.docker.com/engine/network/drivers/bridge/): default versus user-defined bridges and the DNS difference.
- [Volumes](https://docs.docker.com/engine/storage/volumes/): creating, inspecting, backing up and removing named volumes.
- [Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/): syntax, read-only mounts and the trade-offs.
- [Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/): what each memory and CPU flag does.
