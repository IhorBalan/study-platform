import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');

const REQUEST_TIMEOUT_MS = 5000;

let loaded;
async function loadCreateServer() {
  loaded ??= import(pathToFileURL(path.join(submissionDir, 'server.mjs')).href);
  const mod = await loaded;
  assert.equal(
    typeof mod.createServer,
    'function',
    'server.mjs must export a function named createServer',
  );
  return mod.createServer;
}

/** Starts a fresh server on a random port, runs `fn(port)`, and always closes the server. */
async function withServer(fn) {
  const createServer = await loadCreateServer();
  const server = createServer();
  assert.ok(
    server && typeof server.listen === 'function',
    'createServer() must return a node:http server',
  );
  assert.equal(server.listening, false, 'createServer() must return a server that is not listening yet');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await fn(server.address().port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * Minimal HTTP client on node:http. `body` may be a string, a Buffer, or an
 * array of chunks. An array is sent with chunked transfer encoding, so no
 * Content-Length header goes out.
 */
function request(port, { method = 'GET', path: target = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const allHeaders = { ...headers };
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      allHeaders['content-length'] = Buffer.byteLength(body);
    }
    const req = http.request(
      { host: '127.0.0.1', port, method, path: target, headers: allHeaders, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timer);
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = text === '' ? undefined : JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
        res.on('error', fail);
      },
    );
    let responded = false;
    req.on('response', () => {
      responded = true;
    });
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      req.destroy();
      fail(new Error(`${method} ${target} got no response within ${REQUEST_TIMEOUT_MS} ms`));
    }, REQUEST_TIMEOUT_MS);
    // A server may answer before it has read the whole body. Ignore write errors after that.
    req.on('error', (error) => {
      if (!responded) fail(new Error(`${method} ${target} failed: ${error.message}`));
    });
    if (Array.isArray(body)) {
      for (const chunk of body) req.write(chunk);
      req.end();
    } else {
      req.end(body);
    }
  });
}

const JSON_HEADERS = { 'content-type': 'application/json' };

function postNote(port, text) {
  return request(port, {
    method: 'POST',
    path: '/notes',
    headers: JSON_HEADERS,
    body: JSON.stringify({ text }),
  });
}

function mediaType(res) {
  return String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
}

function expectStatus(res, expected, what) {
  assert.equal(res.status, expected, `${what}: expected status ${expected}, got ${res.status}`);
}

async function createdNote(port, text) {
  const res = await postNote(port, text);
  expectStatus(res, 201, `POST /notes with {"text": ${JSON.stringify(text)}}`);
  assert.ok(res.json && typeof res.json.id === 'string', 'POST /notes must return the created note with a string id');
  return res.json;
}

test('create-note: POST /notes creates a note and returns 201 with a Location header', async () => {
  await withServer(async (port) => {
    const res = await postNote(port, 'buy milk');
    expectStatus(res, 201, 'POST /notes with a valid body');
    assert.equal(mediaType(res), 'application/json', `expected Content-Type application/json, got "${res.headers['content-type']}"`);
    assert.ok(res.json, 'the 201 response body must be JSON');
    assert.equal(typeof res.json.id, 'string', 'the created note must have a string id');
    assert.ok(res.json.id.length > 0, 'the created note id must not be empty');
    assert.equal(res.json.text, 'buy milk', 'the created note must echo the text that was sent');
    assert.equal(
      res.headers.location,
      `/notes/${res.json.id}`,
      `expected Location to be /notes/<id>, got "${res.headers.location}"`,
    );

    const second = await postNote(port, 'call mum');
    expectStatus(second, 201, 'second POST /notes');
    assert.notEqual(second.json?.id, res.json.id, 'two notes must not share an id');

    const withCharset = await request(port, {
      method: 'POST',
      path: '/notes',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text: 'grüße' }),
    });
    expectStatus(withCharset, 201, 'POST /notes with Content-Type "application/json; charset=utf-8"');
    assert.equal(withCharset.json?.text, 'grüße', 'non-ASCII text must survive the round trip');
  });
});

test('read-note: GET /notes and GET /notes/:id return the stored notes', async () => {
  await withServer(async (port) => {
    const empty = await request(port, { path: '/notes' });
    expectStatus(empty, 200, 'GET /notes on a new server');
    assert.equal(mediaType(empty), 'application/json', `expected Content-Type application/json, got "${empty.headers['content-type']}"`);
    assert.deepEqual(empty.json, [], 'GET /notes on a new server must return an empty JSON array');

    const a = await createdNote(port, 'first');
    const b = await createdNote(port, 'second');

    const list = await request(port, { path: '/notes' });
    expectStatus(list, 200, 'GET /notes');
    assert.deepEqual(
      list.json,
      [
        { id: a.id, text: 'first' },
        { id: b.id, text: 'second' },
      ],
      'GET /notes must return every note, in creation order, as { id, text }',
    );

    const one = await request(port, { path: `/notes/${b.id}` });
    expectStatus(one, 200, 'GET /notes/:id for an existing note');
    assert.deepEqual(one.json, { id: b.id, text: 'second' }, 'GET /notes/:id must return that note');

    const withQuery = await request(port, { path: '/notes?limit=10' });
    expectStatus(withQuery, 200, 'GET /notes?limit=10 (a query string must not break routing)');
  });
});

test('delete-note: DELETE /notes/:id removes the note and returns 204', async () => {
  await withServer(async (port) => {
    const keep = await createdNote(port, 'keep');
    const drop = await createdNote(port, 'drop');

    const res = await request(port, { method: 'DELETE', path: `/notes/${drop.id}` });
    expectStatus(res, 204, 'DELETE /notes/:id for an existing note');
    assert.equal(res.text, '', 'a 204 response must not have a body');

    const list = await request(port, { path: '/notes' });
    assert.deepEqual(list.json, [{ id: keep.id, text: 'keep' }], 'after the delete only the other note may remain');

    const again = await request(port, { method: 'DELETE', path: `/notes/${drop.id}` });
    expectStatus(again, 404, 'DELETE /notes/:id for a note that was already deleted');
  });
});

test('invalid-json: a body that is not valid JSON gets 400', async () => {
  await withServer(async (port) => {
    for (const body of ['{"text": "unterminated', 'text=hello', '']) {
      const res = await request(port, { method: 'POST', path: '/notes', headers: JSON_HEADERS, body });
      expectStatus(res, 400, `POST /notes with body ${JSON.stringify(body)}`);
    }
    const list = await request(port, { path: '/notes' });
    assert.deepEqual(list.json, [], 'a rejected request must not create a note');
  });
});

test('invalid-shape: valid JSON with the wrong shape gets 422', async () => {
  await withServer(async (port) => {
    for (const value of [{}, { text: '' }, { text: 42 }, { title: 'x' }, ['text'], 'text', null]) {
      const body = JSON.stringify(value);
      const res = await request(port, { method: 'POST', path: '/notes', headers: JSON_HEADERS, body });
      expectStatus(res, 422, `POST /notes with body ${body}`);
    }
    const list = await request(port, { path: '/notes' });
    assert.deepEqual(list.json, [], 'a rejected request must not create a note');
  });
});

test('wrong-media-type: a POST without a JSON Content-Type gets 415', async () => {
  await withServer(async (port) => {
    const body = JSON.stringify({ text: 'hello' });
    const plain = await request(port, { method: 'POST', path: '/notes', headers: { 'content-type': 'text/plain' }, body });
    expectStatus(plain, 415, 'POST /notes with Content-Type text/plain');
    const none = await request(port, { method: 'POST', path: '/notes', body });
    expectStatus(none, 415, 'POST /notes without a Content-Type header');
  });
});

test('body-limit: a body over 1024 bytes gets 413', async () => {
  await withServer(async (port) => {
    const atLimit = JSON.stringify({ text: 'a'.repeat(1024 - '{"text":""}'.length) });
    assert.equal(Buffer.byteLength(atLimit), 1024);
    const ok = await request(port, { method: 'POST', path: '/notes', headers: JSON_HEADERS, body: atLimit });
    expectStatus(ok, 201, 'POST /notes with a body of exactly 1024 bytes');

    const tooBig = JSON.stringify({ text: 'a'.repeat(3000) });
    const withLength = await request(port, { method: 'POST', path: '/notes', headers: JSON_HEADERS, body: tooBig });
    expectStatus(withLength, 413, 'POST /notes with a 3 kB body and a Content-Length header');

    // Same oversized body, sent in pieces with chunked encoding: no Content-Length to rely on.
    const pieces = [tooBig.slice(0, 700), tooBig.slice(700, 1400), tooBig.slice(1400)];
    const chunked = await request(port, { method: 'POST', path: '/notes', headers: JSON_HEADERS, body: pieces });
    expectStatus(chunked, 413, 'POST /notes with a 3 kB chunked body (no Content-Length header)');

    const list = await request(port, { path: '/notes' });
    assert.equal(list.json?.length, 1, 'oversized requests must not create notes');
  });
});

test('not-found: unknown paths and unknown note ids get 404', async () => {
  await withServer(async (port) => {
    for (const target of ['/', '/nope', '/notes/does-not-exist', '/notes/a/b', '/notesx']) {
      const res = await request(port, { path: target });
      expectStatus(res, 404, `GET ${target}`);
    }
    const del = await request(port, { method: 'DELETE', path: '/notes/does-not-exist' });
    expectStatus(del, 404, 'DELETE /notes/does-not-exist');
    const post = await request(port, { method: 'POST', path: '/nope', headers: JSON_HEADERS, body: '{}' });
    expectStatus(post, 404, 'POST /nope (an unknown path is 404 whatever the method)');
  });
});

test('method-not-allowed: unsupported methods get 405 with an Allow header', async () => {
  await withServer(async (port) => {
    const note = await createdNote(port, 'x');
    const cases = [
      { method: 'PUT', path: '/notes', allow: ['GET', 'POST'] },
      { method: 'DELETE', path: '/notes', allow: ['GET', 'POST'] },
      { method: 'POST', path: `/notes/${note.id}`, allow: ['DELETE', 'GET'] },
      { method: 'PATCH', path: `/notes/${note.id}`, allow: ['DELETE', 'GET'] },
    ];
    for (const { method, path: target, allow } of cases) {
      const res = await request(port, { method, path: target, headers: JSON_HEADERS, body: '{}' });
      expectStatus(res, 405, `${method} ${target}`);
      const listed = String(res.headers.allow ?? '')
        .split(',')
        .map((m) => m.trim().toUpperCase())
        .filter(Boolean)
        .sort();
      assert.deepEqual(
        listed,
        [...allow].sort(),
        `${method} ${target}: expected the Allow header to list exactly ${allow.join(', ')}, got "${res.headers.allow ?? ''}"`,
      );
    }
  });
});

test('problem-json: every error response is an RFC 9457 problem document', async () => {
  await withServer(async (port) => {
    const errors = [
      ['GET /nope', await request(port, { path: '/nope' }), 404],
      ['GET /notes/missing', await request(port, { path: '/notes/missing' }), 404],
      ['PUT /notes', await request(port, { method: 'PUT', path: '/notes' }), 405],
      ['POST /notes with broken JSON', await request(port, { method: 'POST', path: '/notes', headers: JSON_HEADERS, body: '{' }), 400],
      ['POST /notes with {}', await request(port, { method: 'POST', path: '/notes', headers: JSON_HEADERS, body: '{}' }), 422],
      ['POST /notes as text/plain', await request(port, { method: 'POST', path: '/notes', headers: { 'content-type': 'text/plain' }, body: '{}' }), 415],
      ['POST /notes with a 3 kB body', await request(port, { method: 'POST', path: '/notes', headers: JSON_HEADERS, body: JSON.stringify({ text: 'a'.repeat(3000) }) }), 413],
    ];
    for (const [what, res, status] of errors) {
      expectStatus(res, status, what);
      assert.equal(
        mediaType(res),
        'application/problem+json',
        `${what}: expected Content-Type application/problem+json, got "${res.headers['content-type'] ?? ''}"`,
      );
      assert.ok(
        res.json && typeof res.json === 'object' && !Array.isArray(res.json),
        `${what}: the error body must be a JSON object, got: ${res.text.slice(0, 80)}`,
      );
      assert.equal(typeof res.json.type, 'string', `${what}: the problem document needs a string "type"`);
      assert.equal(typeof res.json.title, 'string', `${what}: the problem document needs a string "title"`);
      assert.ok(res.json.title.length > 0, `${what}: "title" must not be empty`);
      assert.equal(
        res.json.status,
        status,
        `${what}: "status" in the body must be the number ${status}, got ${JSON.stringify(res.json.status)}`,
      );
    }
  });
});

test('isolated-state: each createServer() call has its own empty store', async () => {
  await withServer(async (portA) => {
    await createdNote(portA, 'only on A');
    await withServer(async (portB) => {
      const listB = await request(portB, { path: '/notes' });
      expectStatus(listB, 200, 'GET /notes on a second server');
      assert.deepEqual(listB.json, [], 'a second server from createServer() must start with no notes');
      await createdNote(portB, 'only on B');
    });
    const listA = await request(portA, { path: '/notes' });
    assert.equal(listA.json?.length, 1, 'notes created on one server must not appear on another');
  });
});
