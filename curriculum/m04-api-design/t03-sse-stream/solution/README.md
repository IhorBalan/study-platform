# Live messages over Server-Sent Events

```sh
node start.mjs
```

## Notes

History and subscribers live in one process. Behind a load balancer with two instances, a message posted to instance A reaches only the streams open on A, and a client that reconnects to B with `Last-Event-ID` finds a different history with different ids.

To fix it, publish through shared infrastructure and keep ids global: write each message to Postgres (a sequence gives ids) or a Valkey stream (`XADD` gives ids), replay from there on reconnect, and have every instance subscribe (Valkey pub/sub, `XREAD BLOCK`, or Postgres `LISTEN/NOTIFY`) to forward new messages to its own open streams.
