// Checks for "Live messages over Server-Sent Events". Node built-ins only.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { after, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');

const WAIT_MS = 2000;

// A submission that never clears its timers would keep this process alive
// forever. Once every test has finished, give it a moment and then exit.
after(() => {
  setTimeout(() => process.exit(), 1000).unref();
});

let loaded;
async function loadCreateServer() {
  loaded ??= import(pathToFileURL(path.join(submissionDir, 'server.mjs')).href);
  const mod = await loaded;
  assert.equal(typeof mod.createServer, 'function', 'server.mjs must export a function named createServer');
  return mod.createServer;
}

/** Starts a fresh server on a random port, runs `fn(port)`, and always closes the server. */
async function withServer(options, fn) {
  const createServer = await loadCreateServer();
  const server = createServer(options);
  assert.ok(server && typeof server.listen === 'function', 'createServer() must return a node:http server');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const streams = [];
  try {
    return await fn(server.address().port, streams);
  } finally {
    for (const s of streams) s.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(port, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/messages',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(data);
          } catch {
            json = undefined;
          }
          if (res.statusCode !== 201) {
            reject(new Error(`POST /messages: expected status 201, got ${res.statusCode}: ${data.slice(0, 200)}`));
          } else if (typeof json?.id !== 'string') {
            reject(new Error(`POST /messages: expected a JSON body with a string "id", got: ${data.slice(0, 200)}`));
          } else {
            resolve(json);
          }
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Opens GET /events and parses the stream as it arrives. Resolves once the
 * response headers are in. `events` holds dispatched events, `comments` comment lines.
 */
function openStream(port, streams, headers = {}) {
  return new Promise((resolve, reject) => {
    const stream = { status: 0, headers: {}, events: [], comments: [], body: '', waiters: new Set() };
    let buffer = '';
    const notify = () => {
      for (const w of stream.waiters) w();
    };
    const req = http.get({ host: '127.0.0.1', port, path: '/events', agent: false, headers }, (res) => {
      clearTimeout(timer);
      stream.status = res.statusCode;
      stream.headers = res.headers;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        stream.body += chunk;
        buffer += chunk.replace(/\r\n?/g, '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = { id: undefined, event: 'message', data: [] };
          for (const line of frame.split('\n')) {
            if (line.startsWith(':')) {
              stream.comments.push(line);
              continue;
            }
            const colon = line.indexOf(':');
            const field = colon === -1 ? line : line.slice(0, colon);
            const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (field === 'id') event.id = value;
            else if (field === 'event') event.event = value;
            else if (field === 'data') event.data.push(value);
          }
          if (event.data.length > 0) stream.events.push({ ...event, data: event.data.join('\n') });
        }
        notify();
      });
      res.on('error', () => {});
      resolve(stream);
    });
    stream.close = () => req.destroy();
    /** Waits until `predicate(stream)` is true, or fails with `what`. */
    stream.until = (predicate, what, ms = WAIT_MS) =>
      new Promise((ok, fail) => {
        if (predicate(stream)) return ok();
        const t = setTimeout(() => {
          stream.waiters.delete(check);
          fail(new Error(`${what} (waited ${ms} ms; stream so far: ${JSON.stringify(stream.body.slice(-300))})`));
        }, ms);
        const check = () => {
          if (predicate(stream)) {
            clearTimeout(t);
            stream.waiters.delete(check);
            ok();
          }
        };
        stream.waiters.add(check);
      });
    streams.push(stream);
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`GET /events: no response headers within ${WAIT_MS} ms. Send the headers as soon as the stream opens.`));
    }, WAIT_MS);
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`GET /events failed: ${error.message}`));
    });
  });
}

function expectStream(stream) {
  assert.equal(stream.status, 200, `GET /events: expected status 200, got ${stream.status}`);
}

function parseData(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    assert.fail(`An event's data should be JSON, got: ${event.data.slice(0, 200)}`);
  }
}

const countTimers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

test('stream-headers: GET /events opens at once with the SSE content type and no caching', async () => {
  await withServer({}, async (port, streams) => {
    const stream = await openStream(port, streams);
    expectStream(stream);
    assert.match(
      String(stream.headers['content-type']),
      /^text\/event-stream/,
      `GET /events: expected Content-Type text/event-stream, got "${stream.headers['content-type']}"`,
    );
    assert.match(
      String(stream.headers['cache-control']),
      /no-cache|no-store/,
      `GET /events: expected Cache-Control to forbid caching (no-cache), got "${stream.headers['cache-control']}"`,
    );
  });
});

test('live-events: a posted message arrives as an event with its id, the type "message" and JSON data', async () => {
  await withServer({}, async (port, streams) => {
    const stream = await openStream(port, streams);
    expectStream(stream);
    const created = await post(port, 'hello');
    await stream.until((s) => s.events.length >= 1, 'GET /events: the posted message never arrived as an event');
    const [event] = stream.events;
    assert.equal(event.id, created.id, `The event's id field should be the message id "${created.id}", got "${event.id}"`);
    assert.equal(event.event, 'message', `The event type should be "message", got "${event.event}"`);
    assert.deepEqual(parseData(event), { id: created.id, text: 'hello' }, 'The event data should be {"id", "text"} of the message');
    const multi = await post(port, 'line one\nline two');
    await stream.until((s) => s.events.length >= 2, 'GET /events: a message containing a newline never arrived as one event');
    assert.deepEqual(parseData(stream.events[1]), { id: multi.id, text: 'line one\nline two' }, 'A text with a newline must arrive intact in one event');
  });
});

test('fan-out: every open stream receives every message, in order', async () => {
  await withServer({}, async (port, streams) => {
    const a = await openStream(port, streams);
    const b = await openStream(port, streams);
    expectStream(a);
    expectStream(b);
    const ids = [];
    for (const text of ['one', 'two', 'three']) ids.push((await post(port, text)).id);
    for (const [name, s] of [['first', a], ['second', b]]) {
      await s.until((x) => x.events.length >= 3, `The ${name} of two open streams did not receive all 3 messages`);
      assert.deepEqual(s.events.map((e) => e.id), ids, `The ${name} stream received the messages out of order or with the wrong ids`);
    }
  });
});

test('no-history-without-header: a new stream without Last-Event-ID starts with new messages only', async () => {
  await withServer({}, async (port, streams) => {
    await post(port, 'old one');
    await post(port, 'old two');
    const stream = await openStream(port, streams);
    expectStream(stream);
    const fresh = await post(port, 'new');
    await stream.until((s) => s.events.length >= 1, 'GET /events: the new message never arrived');
    await sleep(100);
    assert.deepEqual(
      stream.events.map((e) => e.id),
      [fresh.id],
      'A stream opened without Last-Event-ID should receive only messages posted after it opened',
    );
  });
});

test('resume: a stream opened with Last-Event-ID first replays the missed messages, then continues live', async () => {
  await withServer({}, async (port, streams) => {
    const ids = [];
    for (const text of ['m1', 'm2', 'm3', 'm4', 'm5']) ids.push((await post(port, text)).id);
    const stream = await openStream(port, streams, { 'last-event-id': ids[1] });
    expectStream(stream);
    await stream.until((s) => s.events.length >= 3, `GET /events with Last-Event-ID: ${ids[1]} should replay the 3 later messages`);
    const live = await post(port, 'm6');
    await stream.until((s) => s.events.length >= 4, 'After the replay, a newly posted message never arrived');
    await sleep(100);
    assert.deepEqual(
      stream.events.map((e) => e.id),
      [ids[2], ids[3], ids[4], live.id],
      'Expected the missed messages in order, then the live one, with no duplicates',
    );
    assert.deepEqual(stream.events.map((e) => parseData(e).text), ['m3', 'm4', 'm5', 'm6'], 'The replayed events carry the wrong texts');
  });
});

test('heartbeat: an idle stream receives a comment line at the configured interval', async () => {
  await withServer({ heartbeatMs: 100 }, async (port, streams) => {
    const stream = await openStream(port, streams);
    expectStream(stream);
    await stream.until(
      (s) => s.comments.length >= 2,
      'createServer({ heartbeatMs: 100 }): expected at least 2 comment lines (starting with ":") within the wait',
      1500,
    );
    assert.equal(stream.events.length, 0, 'A heartbeat must be a comment, not an event that EventSource would dispatch');
  });
});

test('cleanup: when a client disconnects, its timers are cleared', async () => {
  await withServer({ heartbeatMs: 50 }, async (port, streams) => {
    await sleep(20);
    const baseline = countTimers();
    const opened = [];
    for (let i = 0; i < 3; i += 1) opened.push(await openStream(port, streams));
    for (const s of opened) expectStream(s);
    await opened[0].until((s) => s.comments.length >= 1, 'No heartbeat arrived on a stream with heartbeatMs: 50');
    for (const s of opened) s.close();
    await sleep(200);
    const left = countTimers();
    assert.ok(
      left <= baseline,
      `After 3 clients disconnected, ${left - baseline} more timer(s) were still active than before they connected. Clear each stream's timers when its connection closes.`,
    );
    const after = await post(port, 'still works');
    assert.equal(typeof after.id, 'string', 'POST /messages should still work after clients disconnected');
  });
});
