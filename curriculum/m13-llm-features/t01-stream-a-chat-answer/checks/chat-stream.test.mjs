// Checks for "Stream a model's answer over SSE". Node built-ins only.
// A fake OpenAI-compatible server stands in for the model, so no network or API key is needed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const SECRET = 'internal-trace-7f3a';
const TIMEOUT_MS = 1500;

const state = { compileOutput: null, bootError: null, app: null, base: null, upstream: null };

// ---------- fake upstream ----------

/** Every request the fake model received: { body, closedEarly, finished }. */
const calls = [];

function chunk(delta, finish = null, usage) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fake',
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lastUserText(body) {
  const user = (body.messages ?? []).filter((m) => m.role === 'user').at(-1);
  if (!user) return '';
  return typeof user.content === 'string'
    ? user.content
    : (user.content ?? []).map((p) => p.text ?? '').join('');
}

async function handle(req, res) {
  let raw = '';
  for await (const c of req) raw += c;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  const call = { url: req.url, body, closedEarly: false, finished: false };
  calls.push(call);
  res.on('close', () => {
    if (!res.writableFinished) call.closedEarly = true;
  });
  const text = lastUserText(body);
  if (text.includes('MODE_429')) {
    res.writeHead(429, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: `Rate limit reached for ${SECRET}`, type: 'rate_limit' } }));
  }
  if (text.includes('MODE_500')) {
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: `Backend crashed at ${SECRET}`, type: 'server_error' } }));
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  if (text.includes('MODE_STALL')) {
    res.write(': waiting\n\n');
    return; // never sends a token
  }
  let words = ['Hello', ',', ' world', '!'];
  let delay = 0;
  if (text.includes('MODE_SLOW')) {
    words = Array.from({ length: 10 }, (_, i) => `w${i} `);
    delay = 100;
  }
  if (text.includes('MODE_ENDLESS')) {
    words = Array.from({ length: 40 }, (_, i) => `t${i} `);
    delay = 60;
  }
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send(chunk({ role: 'assistant', content: '' }));
  for (const w of words) {
    if (res.destroyed) return;
    send(chunk({ content: w }));
    if (delay) await sleep(delay);
  }
  if (res.destroyed) return;
  send(chunk({}, 'stop', { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }));
  call.finished = true;
  res.end('data: [DONE]\n\n');
}

// ---------- submission ----------

async function importFromSubmission(specifier) {
  const require = createRequire(path.join(dir, 'package.json'));
  return import(pathToFileURL(require.resolve(specifier)).href);
}

function compile() {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  if (!existsSync(path.join(dir, 'tsconfig.json'))) return 'tsconfig.json is missing from the submission.';
  if (!existsSync(tsc)) return 'node_modules/.bin/tsc was not found in the submission directory.';
  rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  if (result.status === 0) return null;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 4000) || `tsc exited with status ${result.status}`;
}

async function boot() {
  const entry = path.join(dir, 'dist', 'app.module.js');
  if (!existsSync(entry)) throw new Error('dist/app.module.js was not produced. Keep src/app.module.ts and outDir "dist".');
  await importFromSubmission('reflect-metadata');
  const { NestFactory } = await importFromSubmission('@nestjs/core');
  const { AppModule } = await import(pathToFileURL(entry).href);
  if (typeof AppModule !== 'function') throw new Error('src/app.module.ts must export a class named AppModule.');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  state.app = app;
  await app.listen(0, '127.0.0.1');
  state.base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
}

before(async () => {
  state.upstream = http.createServer((req, res) => {
    handle(req, res).catch(() => res.destroy());
  });
  await new Promise((r) => state.upstream.listen(0, '127.0.0.1', r));
  process.env.LLM_BASE_URL = `http://127.0.0.1:${state.upstream.address().port}/v1`;
  process.env.LLM_MODEL = 'fake-model-1';
  process.env.LLM_API_KEY = 'not-a-real-key';
  process.env.LLM_TIMEOUT_MS = String(TIMEOUT_MS);
  state.compileOutput = compile();
  if (state.compileOutput) return;
  try {
    await boot();
  } catch (error) {
    state.bootError = String(error?.message ?? error).slice(0, 1500);
  }
});

after(async () => {
  await state.app?.close();
  state.upstream?.closeAllConnections();
  await new Promise((r) => state.upstream?.close(r));
});

function ready() {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.bootError, `The app did not start: ${state.bootError}`);
}

/** Parses an SSE body into [{ event, data }] as events arrive. */
async function* sseEvents(res) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true }).replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length === 0) continue;
      const text = data.join('\n');
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      yield { event, raw: text, data: json, at: Date.now() };
    }
  }
}

function post(body, signal) {
  return fetch(`${state.base}/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(8000),
  });
}

async function collect(message) {
  const res = await post({ message });
  assert.equal(res.status, 200, `POST /chat/stream: expected status 200, got ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  assert.ok(type.startsWith('text/event-stream'), `POST /chat/stream: expected content type text/event-stream, got "${type}"`);
  const events = [];
  for await (const e of sseEvents(res)) events.push(e);
  return events;
}

const describe = (events) => events.map((e) => `${e.event}:${e.raw}`).join(' | ').slice(0, 600) || '(no events)';

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('streams-deltas: each text delta is forwarded as a "delta" event, then one "done" event with usage', async () => {
  ready();
  const events = await collect('Say hello');
  const deltas = events.filter((e) => e.event === 'delta');
  assert.ok(deltas.length >= 3, `Expected one "delta" event per model chunk (at least 3), got ${deltas.length}: ${describe(events)}`);
  for (const d of deltas) {
    assert.equal(typeof d.data?.text, 'string', `Each "delta" event's data must be JSON like {"text":"..."}, got: ${d.raw}`);
  }
  assert.equal(deltas.map((d) => d.data.text).join(''), 'Hello, world!', 'The delta texts, joined, must equal the model output "Hello, world!"');
  const last = events.at(-1);
  assert.equal(last?.event, 'done', `The last event must be "done", got: ${describe(events)}`);
  assert.equal(events.filter((e) => e.event === 'done').length, 1, 'Send exactly one "done" event.');
  assert.equal(last.data?.finishReason, 'stop', `"done" must carry finishReason "stop", got: ${last.raw}`);
  assert.equal(last.data?.usage?.inputTokens, 7, `"done" must carry usage.inputTokens from the model (7), got: ${last.raw}`);
  assert.equal(last.data?.usage?.outputTokens, 3, `"done" must carry usage.outputTokens from the model (3), got: ${last.raw}`);
});

test('incremental: the first delta reaches the client before the model has finished', async () => {
  ready();
  const started = Date.now();
  const events = await collect('MODE_SLOW please');
  const first = events.find((e) => e.event === 'delta');
  const done = events.find((e) => e.event === 'done');
  assert.ok(first && done, `Expected deltas and a "done" event, got: ${describe(events)}`);
  assert.ok(
    first.at - started < 600 && done.at - first.at > 500,
    `The fake model takes about a second to stream ten chunks. The first delta arrived after ${first.at - started} ms and "done" ${done.at - first.at} ms later, so the answer was buffered instead of streamed.`,
  );
});

test('upstream-request: the model gets the configured model id, a system instruction, the user message and an output cap', async () => {
  ready();
  const before = calls.length;
  await collect('What is a sprint?');
  const call = calls.slice(before).at(-1);
  assert.ok(call, 'No request reached the model server at LLM_BASE_URL.');
  assert.match(call.url, /\/chat\/completions$/, `Expected a request to /chat/completions, got ${call.url}`);
  const b = call.body;
  assert.equal(b.model, 'fake-model-1', `Use the model id from LLM_MODEL, got ${JSON.stringify(b.model)}`);
  assert.equal(b.stream, true, 'Request a streamed response from the model.');
  const system = (b.messages ?? []).filter((m) => m.role === 'system');
  assert.ok(system.length >= 1, 'Send system instructions (the AI SDK `instructions` option), so the model knows its role.');
  assert.equal(lastUserText(b), 'What is a sprint?', 'The user\'s message must reach the model as a user message, unchanged.');
  assert.ok(
    !system.some((m) => JSON.stringify(m.content).includes('What is a sprint?')),
    'The user\'s message must not be pasted into the system instructions.',
  );
  assert.ok(
    Number.isInteger(b.max_tokens) && b.max_tokens > 0 && b.max_tokens <= 1024,
    `Cap the output with maxOutputTokens (1 to 1024); the request had max_tokens = ${JSON.stringify(b.max_tokens)}`,
  );
});

test('validates-input: a missing, empty, non-string or too long message gets 400 and never reaches the model', async () => {
  ready();
  const cases = [
    [{}, 'no message'],
    [{ message: '' }, 'an empty message'],
    [{ message: 42 }, 'a number as the message'],
    [{ message: 'x'.repeat(4001) }, 'a message of 4001 characters'],
  ];
  for (const [body, what] of cases) {
    const before = calls.length;
    const res = await post(body);
    await res.body?.cancel().catch(() => {});
    assert.equal(res.status, 400, `POST /chat/stream with ${what}: expected status 400, got ${res.status}`);
    assert.equal(calls.length, before, `POST /chat/stream with ${what}: the request was sent to the model anyway`);
  }
  const ok = await collect('y'.repeat(4000));
  assert.equal(ok.at(-1)?.event, 'done', 'A message of exactly 4000 characters must be accepted.');
});

test('maps-errors: upstream failures end the stream at once with an "error" event carrying only a code', async () => {
  ready();
  for (const [message, code] of [
    ['MODE_429 now', 'rate_limited'],
    ['MODE_500 now', 'upstream_error'],
  ]) {
    const before = calls.length;
    const events = await collect(message);
    const attempts = calls.length - before;
    assert.equal(attempts, 1, `For one client request, call the model once (maxRetries: 0); it was called ${attempts} times.`);
    const last = events.at(-1);
    assert.equal(last?.event, 'error', `When the model answers ${message.slice(5, 8)}, the last event must be "error", got: ${describe(events)}`);
    assert.equal(last.data?.code, code, `When the model answers ${message.slice(5, 8)}, the error code must be "${code}", got: ${last.raw}`);
    assert.ok(!events.some((e) => e.event === 'done'), 'A failed answer must not also send "done".');
    assert.ok(
      !events.some((e) => e.raw.includes(SECRET)),
      'The upstream error message was forwarded to the client. Send a code, keep the details in your logs.',
    );
  }
});

test('cancels-upstream: when the client disconnects, the request to the model is aborted', async () => {
  ready();
  const before = calls.length;
  const controller = new AbortController();
  const res = await post({ message: 'MODE_ENDLESS go' }, controller.signal);
  assert.equal(res.status, 200, `POST /chat/stream: expected status 200, got ${res.status}`);
  let seen = 0;
  try {
    for await (const e of sseEvents(res)) {
      if (e.event === 'delta' && ++seen === 2) {
        controller.abort();
        break;
      }
    }
  } catch {
    // aborting the fetch ends the body with an AbortError
  }
  assert.equal(seen, 2, 'Expected at least two delta events before disconnecting.');
  const call = calls[before];
  assert.ok(call, 'No request reached the model server.');
  const deadline = Date.now() + 1500;
  while (!call.closedEarly && !call.finished && Date.now() < deadline) await sleep(50);
  assert.ok(
    call.closedEarly,
    call.finished
      ? 'The client went away, but the model kept generating to the end. Abort the upstream call when the client disconnects.'
      : 'Within 1.5 s of the client disconnecting, the request to the model was still open. Abort it when the client goes away.',
  );
});

test('timeout: a model that stops sending ends with an "error" event with code "timeout" after LLM_TIMEOUT_MS', async () => {
  ready();
  const before = calls.length;
  const started = Date.now();
  const events = await collect('MODE_STALL hello');
  const took = Date.now() - started;
  const last = events.at(-1);
  assert.equal(last?.event, 'error', `A stalled model must end the stream with an "error" event, got: ${describe(events)}`);
  assert.equal(last.data?.code, 'timeout', `The error code for a stalled model must be "timeout", got: ${last.raw}`);
  assert.ok(took >= TIMEOUT_MS - 200 && took < TIMEOUT_MS + 2500, `LLM_TIMEOUT_MS was ${TIMEOUT_MS}; the stream ended after ${took} ms.`);
  await sleep(100);
  assert.ok(calls.slice(before).every((c) => c.closedEarly), 'After the timeout the request to the model was left open. Abort it.');
});
