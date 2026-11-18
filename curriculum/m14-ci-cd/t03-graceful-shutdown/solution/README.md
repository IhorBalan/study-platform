# Graceful shutdown

Run it with `pnpm start` (or `node server.mjs`). Stop it with Ctrl+C, or from another terminal:

```sh
kill -TERM <pid>
```

Try it by hand: start a slow request with `curl "localhost:3000/work?ms=5000"`, then send SIGTERM while it runs.

## Notes

The signal handler flips a flag first, so `/healthz/ready` answers 503 while the server keeps serving for `SHUTDOWN_DELAY_MS`. That gives the load balancer time to see the failing probe and stop routing here. Then `server.close()` stops accepting, `closeIdleConnections()` drops idle keep-alive sockets, and responses sent during the drain carry `Connection: close`. When the last request ends, the close callback exits with 0. A timer started at the signal forces exit 1 if the drain takes longer than `SHUTDOWN_TIMEOUT_MS`.

For a real deployment: the delay should be a little longer than the time the load balancer needs to act on a failing probe (probe period times failure threshold, plus propagation), typically 5 to 15 seconds. The timeout must be shorter than the platform grace period (30 seconds by default on Kubernetes; other platforms differ, so check the setting), and longer than the delay plus the slowest request you are willing to wait for.
