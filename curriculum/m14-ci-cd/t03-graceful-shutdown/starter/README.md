# Graceful shutdown

Run it with `pnpm start` (or `node server.mjs`). Stop it with Ctrl+C, or from another terminal:

```sh
kill -TERM <pid>
```

Try it by hand: start a slow request with `curl "localhost:3000/work?ms=5000"`, then send SIGTERM while it runs.

## Notes

TODO: a few lines on how your shutdown works, and how you would pick SHUTDOWN_DELAY_MS and SHUTDOWN_TIMEOUT_MS for a real deployment.
