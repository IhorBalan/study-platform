The starter has a tiny API in `api/` and a first-draft `compose.yaml` that starts but publishes the database to the whole network, hard-codes its password, loses its data and races the database at start-up. Turn it into a file you would be happy to hand to a teammate.

## Requirements

Edit `compose.yaml`. Keep the service names.

1. **Services.** `api` (built from `./api`, listens on 3000), `db` (PostgreSQL) and `adminer` (an admin UI such as the `adminer` image, which listens on 8080).
2. **Data.** `db` stores its data in a named volume declared under top-level `volumes`, mounted at the image's data path (under `/var/lib/postgresql`).
3. **Health.** `db` has a `healthcheck`.
4. **Start order.** `api` depends on `db` with `condition: service_healthy`.
5. **Ports.** `api` and `adminer` each publish a port, and every published port in the file is bound to `127.0.0.1`. `db` publishes nothing.
6. **Networks.** `db` is attached only to a network marked `internal: true`. `api` is on that network and on at least one normal network.
7. **Profile.** `adminer` has the profile `admin`. `api` and `db` have no profile.
8. **Secrets.** No password appears in `compose.yaml`. Every variable whose name contains `PASSWORD`, `SECRET` or `TOKEN`, and the password inside `DATABASE_URL`, comes from `${…}` substitution or an `env_file`. `db` must still receive a password. The API reads `DATABASE_URL` (`postgres://user:password@host:port/database`).
9. **Notes.** Answer the three questions in `NOTES.md`.

## Submission

The checks cannot run Docker, so they read a rendered copy of your file. Generate it and commit it with everything else:

```sh
docker compose --profile admin config --no-interpolate --format json > compose.json
```

`--no-interpolate` keeps `${…}` references as written, so your real password never lands in the committed file. Commit `compose.yaml`, `compose.json`, `.env.example` and `NOTES.md`. Do not commit `.env`.

## What is checked

Requirements 1 to 8, from `compose.json` only. The review reads `compose.yaml` and `NOTES.md`. Try it for real first:

```sh
cp .env.example .env    # then set POSTGRES_PASSWORD
docker compose --profile admin up -d --wait
curl http://127.0.0.1:3000/healthz
```
