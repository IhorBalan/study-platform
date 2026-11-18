---
title: "Real-time: SSE, WebSockets and Socket.IO"
skills: [api-realtime]
---

HTTP is request and response: the client asks, the server answers, done. Chat messages, build logs, notifications, live dashboards and streamed LLM output need the server to speak first. There are three practical ways to do that from a Node backend. They differ in direction, in what the browser gives you for free, and in what happens when you run more than one instance.

## Options at a glance

| | Polling | Server-Sent Events | WebSocket | Socket.IO |
| --- | --- | --- | --- | --- |
| Direction | client asks | server to client | both ways | both ways |
| Transport | plain HTTP | one long HTTP response | upgraded TCP connection | WebSocket, or HTTP long-polling as a fallback |
| Browser API | `fetch` | `EventSource` | `WebSocket` | `socket.io-client` library |
| Reconnect and resume | n/a | built in (`Last-Event-ID`) | write it yourself | built in |
| Rooms, acknowledgements | n/a | no | no | yes |

Start with the simplest one that fits. Polling every 30 seconds is fine for a status that changes hourly. For a one-way stream (notifications, progress, logs, tokens from an LLM), SSE is usually enough. Reach for WebSockets when the client also sends a steady stream of messages, such as chat, collaborative editing or games.

## Server-Sent Events

SSE is an ordinary `GET` whose response never ends. The body is a text stream of events, each made of `field: value` lines and ended by a blank line:

```text
retry: 3000

id: 41
event: message
data: {"id":"41","text":"Deploy finished"}

: ping

```

- `data` is the payload. Put JSON on one line; `JSON.stringify` escapes newlines for you.
- `id` is remembered by the browser. If the connection drops, `EventSource` reconnects on its own after `retry` milliseconds and sends `Last-Event-ID: 41`, so the server can replay what was missed.
- `event` sets the type that `addEventListener` listens for (the default is `message`).
- A line starting with `:` is a comment. Sending one every 15 to 30 seconds keeps proxies and load balancers from closing an idle connection.

The response needs `Content-Type: text/event-stream` and `Cache-Control: no-cache`, and nothing in between may buffer it (compression middleware and some reverse proxies do, by default).

On plain `node:http`, a stream is a response you keep open:

```ts
import http from 'node:http';

const clients = new Set<http.ServerResponse>();

http.createServer((req, res) => {
  if (req.url !== '/events') return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}).listen(3000, '127.0.0.1');

export function broadcast(id: number, payload: unknown) {
  const frame = `id: ${id}\nevent: message\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(frame);
}
```

The `close` handler is not optional. Without it, every disconnected tab leaves a timer and a dead entry behind.

In NestJS, `@Sse()` turns a handler that returns an `Observable<MessageEvent>` into a stream and writes the framing for you. Nest 12 also offers `@SseSignal()`, an `AbortSignal` that fires when the stream ends, for releasing resources you set up before returning the observable.

```ts
@Sse('events')
events(@Headers('last-event-id') lastEventId?: string): Observable<MessageEvent> {
  return this.feed.since(lastEventId).pipe(map((m) => ({ id: String(m.id), type: 'message', data: m })));
}
```

Two browser limits to know: `EventSource` cannot set custom request headers, so authenticate with a cookie (or use a `fetch`-based SSE client); and over HTTP/1.1 a browser allows only about six connections per host, which several open tabs can use up. HTTP/2 removes that limit.

## WebSockets

A WebSocket starts as an HTTP request with `Upgrade: websocket` and then becomes a full-duplex channel of messages on the same TCP connection. It is low-overhead and truly bidirectional. It is also bare: there is no reconnect, no resume, no request and response pairing, and no rooms. Libraries add those.

**Socket.IO** is the most common such library in Node. It is its own protocol on top of WebSocket (a plain `WebSocket` client cannot talk to it), and it adds automatic reconnection, acknowledgements, rooms, namespaces and a fallback to HTTP long-polling for networks that block WebSockets.

NestJS wraps it in **gateways**, which are to sockets what controllers are to HTTP routes:

```ts
import {
  ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: 'chat' })
export class ChatGateway {
  @WebSocketServer() server!: Server;

  @SubscribeMessage('join')
  join(@ConnectedSocket() client: Socket, @MessageBody() room: string) {
    void client.join(room);
    return { joined: room };                       // sent back as the acknowledgement
  }

  @SubscribeMessage('say')
  say(@MessageBody() msg: { room: string; text: string }) {
    this.server.to(msg.room).emit('message', { text: msg.text, at: Date.now() });
  }
}
```

Guards, pipes, interceptors and exception filters work on gateway handlers too, so validation and authorisation look the same as for HTTP. One trap that Nest documents on the hook itself: `handleConnection()` does not hold back the client's messages, so an async authentication check there can lose the race. Reject unauthenticated clients in connection middleware (`server.use()` in `afterInit()`) instead.

## Past one instance

Every connection lives in one process. Run two instances behind a load balancer and `server.to('room-7').emit(...)` on instance A reaches only the sockets that happen to be connected to A. The same goes for the SSE `clients` set above.

The fix is a shared message bus that every instance subscribes to. With Socket.IO, the Redis adapter does this, and it works with Valkey because Valkey speaks the same protocol:

```ts
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { ServerOptions } from 'socket.io';

export class ValkeyIoAdapter extends IoAdapter {
  private adapter?: ReturnType<typeof createAdapter>;

  async connect(url: string) {
    const pub = createClient({ url });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    this.adapter = createAdapter(pub, sub);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapter!);
    return server;
  }
}

// main.ts
const adapter = new ValkeyIoAdapter(app);
await adapter.connect(process.env.VALKEY_URL!);
app.useWebSocketAdapter(adapter);
```

Each broadcast is published to Valkey, and every instance delivers it to its own local sockets. Three things still need attention:

- **Sticky sessions.** Socket.IO's long-polling fallback sends several HTTP requests per session, and they must reach the same instance. Enable sticky sessions on the load balancer, or allow only the WebSocket transport.
- **Pub/sub forgets.** Valkey pub/sub delivers to whoever is subscribed right now. A client that was disconnected for ten seconds misses those messages. If missed messages matter, store them (a Postgres table or a Valkey stream with `XADD`) and replay on reconnect, which is exactly what `Last-Event-ID` is for in SSE.
- **Connection count is the real limit.** Each open connection holds memory and a file descriptor. Plan capacity in concurrent connections, and drain connections gracefully on deploy so clients reconnect to new instances in a trickle, not all at once.

For SSE, the same pattern is a few lines: each instance subscribes to a Valkey channel and calls its local `broadcast()` for every message it receives.

## Common mistakes

- Choosing WebSockets for a one-way feed that SSE would handle with automatic reconnect.
- Forgetting the `close` handler, so timers and subscriptions leak with every disconnected client.
- A proxy or compression middleware buffering the SSE stream, so events arrive in bursts.
- Broadcasting from in-memory state on several instances without a shared bus.
- Expecting pub/sub to deliver messages sent while a client was offline.
- Authenticating in an async `handleConnection()` and assuming no message arrives before it finishes.

## Go deeper

- [HTML Standard: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html): the event stream format and `EventSource` reconnection rules.
- [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events): client and server examples.
- [NestJS: Gateways](https://docs.nestjs.com/websockets/gateways): decorators, lifecycle hooks and adapters.
- [Socket.IO: Redis adapter](https://socket.io/docs/v4/redis-adapter/): how broadcasts cross instances, and its limits.
- [Valkey: Pub/Sub](https://valkey.io/topics/pubsub/): delivery semantics of channels.
