# Notes

1. **Who can reach the database.** `db` is attached only to `data`, which is `internal: true`:
   it has no route to the outside and its ports cannot be published. `api` and `adminer` are
   attached to both `data` and `edge`, so they resolve `db` by name and connect on 5432.
   Nothing on the LAN can connect to PostgreSQL directly. From the host I use
   `docker compose exec db psql -U orders orders`, or start the `admin` profile and open
   Adminer on 127.0.0.1:8080.

2. **The password.** Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`. `.env` is
   git-ignored. Compose reads it for substitution, and `${POSTGRES_PASSWORD:?…}` stops with a
   clear message if it is missing, so the stack never starts with an empty or default
   password. The same variable feeds the `db` container and the `api` connection string.

3. **Keeping or deleting data.** `docker compose down` removes the containers and networks
   and keeps the `db-data` volume. `docker compose down -v` also deletes `db-data`, which is
   the whole database.
