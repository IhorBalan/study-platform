# Notes

1. **Stages.** `build` holds the manifest, the build script and the sources and produces
   `dist/`. `runtime` starts again from the slim base and copies only `dist/` and
   `package.json`. The final image therefore has no `scripts/`, no `src/`, no npm cache and,
   once the project has dependencies, no dev dependencies. Both stages use the same pinned
   base, `node:24-trixie-slim`, so the Node version that builds is the one that runs.

2. **Rebuild time.** Copying `package.json` and installing before copying the sources. The
   original `COPY . .` came first, so every edit to `src/` invalidated the install layer. Now
   a source edit reuses the install layer and only re-runs the two cheap `COPY` steps and the
   build. The `.dockerignore` helps too: the context no longer includes `node_modules` or
   `.git`, so it is small and unrelated file changes do not invalidate `COPY` layers.

3. **Stopping.** `CMD npm start` in shell form made `/bin/sh` PID 1, with npm and then node
   below it. `docker stop` sends SIGTERM to PID 1 only, the signal did not reach the server,
   and Docker killed everything after 10 seconds. With `CMD ["node", "dist/server.js"]` node
   is PID 1, its SIGTERM handler runs, `server.close()` lets in-flight requests finish and
   the container exits with code 0 almost at once.
