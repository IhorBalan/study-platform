The starter is a small HTTP service (`src/server.js`, no dependencies yet) with a build step (`npm run build` writes `dist/`) and a Dockerfile that works but is slow to rebuild, large, and runs as root through `npm start`. Rewrite the Dockerfile.

## Requirements

Edit `Dockerfile`, `.dockerignore` and `NOTES.md`. Leave the application code alone.

1. **At least two stages.** Build in one stage, run in another.
2. **Final stage base.** A slim or Alpine variant (for example a `-slim` or `-alpine` tag) or a distroless image, pinned to a version tag or a digest. Not `latest`, and not a bare image name.
3. **Cache-friendly order.** In the stage that installs dependencies, copy `package.json` (and a lockfile if you add one), run the install (`npm ci` or `npm install`), and only then copy the sources. Treat the service as if dependencies will arrive next week.
4. **Lean final stage.** It gets `dist/` with `COPY --from=<earlier stage>` and never copies the whole build context (`COPY . .`).
5. **Non-root.** The final stage ends up with a `USER` that is not `root` or `0`.
6. **Start command.** `CMD` or `ENTRYPOINT` in exec (JSON array) form, starting `node` directly, not through `npm`, `pnpm`, `yarn` or a shell. The server is `dist/server.js` and listens on port 3000.
7. **`.dockerignore`** excludes at least `node_modules` and `.git`.
8. **Health.** Either a `HEALTHCHECK` instruction in the final stage (the service answers `GET /healthz`), or a Dockerfile comment that starts with `# healthcheck:` and explains why there is none.
9. **`NOTES.md`** answers its three questions in a few sentences each.

## What is checked

The checks cannot run Docker. They read `Dockerfile` and `.dockerignore` as text and test requirements 1 to 8; case, comments and line continuations do not matter. Write image names and tags literally rather than through `ARG`. The review then reads your Dockerfile and `NOTES.md`.

Before you submit, prove it to yourself:

```sh
docker build -t greeter .
docker run --rm -d --name greeter -p 127.0.0.1:3000:3000 greeter
curl http://127.0.0.1:3000/hello
docker stop greeter   # should return in well under 10 seconds
```
