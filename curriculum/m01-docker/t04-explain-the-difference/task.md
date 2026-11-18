Three colleagues ask you for help on the same morning. For each scenario, write what happened, why, how to fix it, and one command whose output would confirm your diagnosis. Aim for 100 to 200 words per scenario. Explain the mechanism; do not just name the fix.

## Scenario 1: the data is gone

> "I wanted a clean restart, so I ran `docker compose down -v` and then `docker compose up -d`. The app works, but every table is empty. Yesterday I ran plain `down` and `up` and nothing was lost."

The `db` service mounts `db-data:/var/lib/postgresql`, and `db-data` is declared under the file's top-level `volumes`.

Explain the difference between the two days, whether the data can be recovered, and how the team could protect itself in future.

## Scenario 2: connection refused

```yaml
services:
  api:
    build: .
    environment:
      DATABASE_URL: postgres://shop:${DB_PASSWORD}@localhost:54320/shop
  db:
    image: postgres:18-alpine
    ports:
      - '127.0.0.1:54320:5432'
```

> "From my Mac, `psql -h localhost -p 54320` works. The API container logs `connect ECONNREFUSED 127.0.0.1:54320`. Same host, same port. How?"

Explain why the same address works in one place and not the other, give the corrected `DATABASE_URL`, and say what role the published port plays between the two services.

## Scenario 3: a 1.2 GB image

```dockerfile
FROM node:24
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
RUN rm -rf src node_modules/.cache
CMD ["node", "dist/main.js"]
```

There is no `.dockerignore`. The project folder contains `.git`, a local `node_modules` and a `coverage` report.

List what makes the image large, explain why the `rm -rf` line saves nothing, and outline the Dockerfile you would write instead. A sketch of the stages is enough; a full file is not required.

## What is assessed

Correct cause, a fix that addresses the cause rather than the symptom, and a way to verify it, for each scenario.
