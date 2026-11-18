A small message board on `node:http`. `POST /messages` already stores messages. Add `GET /events`, a Server-Sent Events stream that pushes each new message to every open browser tab and lets a reconnecting tab catch up on what it missed.

## Requirements

Keep `server.mjs` exporting `createServer(options)`, which returns a `node:http` server that is not listening yet. Each call has its own history. `options.heartbeatMs` (default 15000) sets the heartbeat interval. Use Node built-ins only.

`POST /messages` with `{ "text": "hello" }` returns `201` and `{ "id": "1", "text": "hello" }`. Ids are increasing integers, sent as strings. This already works.

`GET /events`:

- Answers `200` straight away with `Content-Type: text/event-stream` and `Cache-Control: no-cache`, and keeps the connection open.
- Sends every message posted while it is open, in order, as one event:

  ```text
  id: 3
  event: message
  data: {"id":"3","text":"hello"}

  ```

  Text may contain newlines; it must still arrive as one event with the text intact.
- Without a `Last-Event-ID` request header, starts with messages posted after it opened. No history.
- With `Last-Event-ID: 2`, first sends every stored message with an id above 2, in order, then continues live with no gaps and no duplicates. That is the header a browser's `EventSource` sends when it reconnects.
- Every `heartbeatMs` while open, sends a comment line (a line starting with `:`), never an event.
- When the client disconnects, stops its heartbeat timer and stops sending to it.

## Submission

`server.mjs`, `start.mjs` and `package.json`. In `README.md`, explain what breaks when this runs as two instances behind a load balancer, and how you would fix it.

## What is checked

The checks start a fresh server per criterion on a random port, open streams with a raw HTTP client, post messages and parse the events as they arrive. They reconnect with `Last-Event-ID`, wait for heartbeats with `heartbeatMs: 100`, and count the active timers before clients connect and after they disconnect. The review looks at event framing, the replay gap and connection clean-up.
