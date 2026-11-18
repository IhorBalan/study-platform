---
title: Streaming model output to the browser
skills: [llm-streaming]
---

A model that needs eight seconds for an answer feels broken if the screen stays blank for eight seconds, and fine if the first words appear after half a second. Streaming does not make generation faster. It moves the first visible output from the end of the call to the start. This lesson connects three streams: the provider's stream into your backend, your stream out to the browser, and the cancellation signal that runs the other way.

## Two streams, one direction each

With `"stream": true`, an OpenAI-compatible endpoint answers with Server-Sent Events. Each event carries a small JSON chunk with the next piece of text, and the last chunks carry the finish reason and usage:

```text
data: {"choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}

data: {"choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}

data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":2}}

data: [DONE]
```

Anthropic's Messages API streams too, with named events (`message_start`, `content_block_delta`, `message_delta`, `message_stop`). You rarely parse either by hand. The AI SDK's `streamText` turns any provider's stream into one sequence of typed parts.

Your backend then streams its own events to the browser. Do not pass the provider's stream through unchanged. You would leak provider details to the client, tie your frontend to one provider's format, and have nowhere to put your own error codes. Define a small event vocabulary of your own instead, for example `delta`, `done` and `error`.

SSE is the usual transport for this, for the reasons in the real-time lesson of module 4: it is one-way, plain HTTP, and it works through proxies. One difference from that lesson: a chat request carries a body, so it is a `POST`. The browser's `EventSource` can only send `GET`, so the client reads the response with `fetch` instead (shown below).

## The AI SDK stream

`streamText` returns at once. Its `stream` property is an async iterable of parts. (In AI SDK 7 it is called `stream`; older versions called it `fullStream`.) The parts you need for a chat endpoint:

| Part | Meaning |
| --- | --- |
| `text-delta` | The next piece of text, in `part.text` |
| `finish` | The end, with `finishReason` and `totalUsage` |
| `error` | The call failed; `part.error` says why |
| `abort` | The call was cancelled through its `abortSignal` |

There are more (`start`, `start-step`, `text-start`, `reasoning-delta`, tool parts), and a `switch` that ignores the ones you do not need is fine.

One behaviour matters a lot: `streamText` does not throw when the provider fails. A 429 or a 500 arrives as an `error` part, and the SDK also calls your `onError` callback (or logs to the console if you pass none). Your loop must handle that part, or the client sees a stream that simply stops.

## A minimal streaming endpoint

Here is the whole idea on plain `node:http`, so nothing is hidden by a framework:

```ts
import http from 'node:http';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';

const model = createOpenAICompatible({ name: 'local', baseURL: process.env.LLM_BASE_URL!, includeUsage: true })
  .chatModel(process.env.LLM_MODEL ?? 'llama3.2');

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

http.createServer(async (req, res) => {
  const clientGone = new AbortController();
  res.on('close', () => clientGone.abort()); // tab closed, Stop pressed, network dropped

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const result = streamText({
    model,
    prompt: 'Explain backpressure in two sentences.',
    maxOutputTokens: 300,
    abortSignal: AbortSignal.any([clientGone.signal, AbortSignal.timeout(30_000)]),
    onError: () => {}, // errors also arrive as stream parts, handled below
  });

  for await (const part of result.stream) {
    if (part.type === 'text-delta') res.write(sse('delta', { text: part.text }));
    else if (part.type === 'finish') res.write(sse('done', { usage: part.totalUsage }));
    else if (part.type === 'error') res.write(sse('error', { code: 'upstream_error' }));
  }
  res.end();
}).listen(3000, '127.0.0.1');
```

`includeUsage: true` asks the OpenAI-compatible server to send token counts at the end of the stream. Without it, many servers send none, and you cannot account for cost.

## Cancellation: the stream that runs backwards

When the user closes the tab, the browser drops the connection. If you do nothing, your server keeps reading from the provider until the answer is complete, and you pay for every token nobody will read. With a hundred users clicking "Stop", that adds up.

The fix is one `AbortSignal` that reaches the provider call. In the example, `res.on('close')` aborts `clientGone`, and the signal passed to `streamText` cancels the upstream HTTP request. The provider sees the connection close and stops generating. `AbortSignal.any()` combines it with a timeout, so either one ends the call.

In NestJS 12, an `@Sse()` handler can take the same kind of signal through the `@SseSignal()` parameter decorator. Nest aborts it when the stream ends for any reason, including a client disconnect. `@Sse()` also accepts a method, so a chat endpoint can be a `POST`:

```ts
@Sse('stream', { method: RequestMethod.POST })
@HttpCode(200) // a POST route answers 201 by default
stream(@Body({ schema: ChatSchema }) body: Chat, @SseSignal() signal: AbortSignal): Observable<MessageEvent> {
  return new Observable((subscriber) => {
    // start streamText with `signal` (plus a timeout), call subscriber.next({ type, data }) per event,
    // subscriber.complete() at the end, and return a teardown function that aborts the call.
  });
}
```

Validation still runs first: a bad body gets a normal `400` JSON response before any stream starts, and before you spend a token.

## Backpressure

A model produces tokens faster than a slow mobile connection may read them. On plain Node, `res.write()` returns `false` when its buffer is full. If you `await once(res, 'drain')` before writing more, your `for await` loop stops pulling from the SDK, which stops reading from the provider. The pressure travels all the way back. Pass `{ signal: clientGone.signal }` to `once()`, or a client that disappears mid-wait leaves the loop hanging.

With an `Observable`, Nest cannot pause your producer. It buffers events for a client that is not reading, and drops the connection once more than `maxPendingDataLength` characters are waiting (4M by default, configurable per route). For chat-sized answers that is fine; for bulk data it is a limit to know about.

## Timeouts and retries

Use two kinds of timeout:

- **A total budget** for the whole answer, so a stuck request cannot hold a connection forever.
- **A stall timeout**, for a stream that started and then stopped sending. The AI SDK's `timeout` option takes `{ totalMs, firstChunkMs, chunkMs }` for this, or you can build it from `AbortSignal.timeout()`.

When the budget runs out, the stream ends with an `abort` part. Tell a timeout apart from a disconnect by checking which signal fired. A client who left needs no event. A client who is still waiting needs an `error` event with a code such as `timeout`.

Retries need more care than in module 8. Before the first token is sent, a retry is invisible to the user, but it doubles the wait, and the SDK's default backoff starts at about two seconds. After tokens have reached the browser, you cannot retry transparently: the user has already read half an answer. A common policy for interactive streams: no automatic retries (`maxRetries: 0`), fail fast with a clear code, and let the client offer a "try again" button. Background jobs, where nobody waits, are where retries with backoff belong.

## Errors the client can act on

Map failures to a small set of codes and keep the details in your logs:

```ts
import { APICallError } from 'ai';

function errorCode(error: unknown): 'rate_limited' | 'upstream_error' {
  if (APICallError.isInstance(error) && error.statusCode === 429) return 'rate_limited';
  return 'upstream_error';
}
```

Never forward the provider's error message. It can contain request ids, internal model names or fragments of your prompt.

## The browser side

`fetch` gives you the body as a stream. Split it on blank lines and parse each event:

```ts
const res = await fetch('/chat/stream', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message }),
  signal: stopButton.signal, // aborting this closes the connection, which cancels the model call
});
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buffer = '';
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  let end;
  while ((end = buffer.indexOf('\n\n')) !== -1) {
    const block = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const event = /^event: (.*)$/m.exec(block)?.[1];
    const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null');
    if (event === 'delta') appendText(data.text);
  }
}
```

The AI SDK also ships a UI protocol and React hooks (`useChat`) that do this for you. Knowing the plain version helps when you debug them.

## Common mistakes

- Waiting for the whole answer and then sending it, so the user stares at a spinner.
- Not wiring the client disconnect to an `AbortSignal`, so abandoned answers are generated and billed in full.
- Ignoring `error` parts: `streamText` does not throw, so the stream just stops.
- Forwarding provider error messages to the browser.
- Retrying after tokens have been sent, so the user sees the answer start twice.
- Compression middleware or a proxy buffering `text/event-stream`, so tokens arrive in bursts.
- A `POST` SSE route in Nest that still answers `201`.

## Go deeper

- [AI SDK: streamText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text): every stream part and option.
- [AI SDK: Stopping streams](https://ai-sdk.dev/docs/advanced/stopping-streams): abort signals end to end.
- [AI SDK: Settings](https://ai-sdk.dev/docs/ai-sdk-core/settings): `maxRetries`, `abortSignal` and the `timeout` budgets.
- [NestJS: Server-Sent Events](https://docs.nestjs.com/techniques/server-sent-events): the `@Sse()` decorator.
- [Node.js: Backpressuring in streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams): why `write()` returns false and what `drain` means.
