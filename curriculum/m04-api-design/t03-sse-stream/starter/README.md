# Live messages over Server-Sent Events

`POST /messages` stores a message, but nobody hears about it. Read the task brief, then build `GET /events` so that open browser tabs receive new messages as they happen, and pick up what they missed after a reconnect.

```sh
node start.mjs
curl -N http://127.0.0.1:3000/events          # terminal 1
curl -X POST http://127.0.0.1:3000/messages \
  -H 'content-type: application/json' -d '{"text":"hello"}'   # terminal 2
```

No packages are needed: use `node:http` only.

## Notes

Write a few lines here: what happens to your history and subscribers when the server runs as two instances behind a load balancer, and what you would use to fix it.
