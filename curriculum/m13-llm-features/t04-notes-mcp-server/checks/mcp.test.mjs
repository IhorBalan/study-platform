// Checks for "A small MCP server". Node built-ins only, plus the MCP client from the submission's SDK.
// The checks start `node dist/main.js` over stdio, exactly as Claude Code or another MCP host would.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const SECRET = 'SECRET-OUTSIDE-NOTES-91c2';
const state = { compileOutput: null, connectError: null, client: null, transport: null, stderr: '', tmp: null };

function compile() {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  if (!existsSync(path.join(dir, 'tsconfig.json'))) return 'tsconfig.json is missing from the submission.';
  if (!existsSync(tsc)) return 'node_modules/.bin/tsc was not found in the submission directory.';
  rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  if (result.status === 0) return null;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 4000) || `tsc exited with status ${result.status}`;
}

function makeNotes() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mcp-notes-'));
  const notes = path.join(root, 'notes');
  mkdirSync(notes);
  writeFileSync(path.join(notes, 'deploy.md'), '# Deploy checklist\n\nRun the database migrations before switching traffic.\n');
  writeFileSync(path.join(notes, 'standup.md'), '# Standup\n\nYesterday: fixed the MIGRATIONS lock. Today: review.\n');
  writeFileSync(path.join(notes, 'shopping-list.md'), 'Milk, coffee, oat biscuits.\n');
  for (let i = 1; i <= 12; i++) writeFileSync(path.join(notes, `log-${i}.md`), `Daily log ${i}: nothing about deploys.\n`);
  writeFileSync(path.join(notes, 'not-a-note.txt'), 'This is not Markdown.\n');
  writeFileSync(path.join(root, 'secret.md'), `${SECRET}\n`);
  writeFileSync(path.join(root, 'secret'), `${SECRET}\n`);
  mkdirSync(path.join(root, 'notes-private'));
  writeFileSync(path.join(root, 'notes-private', 'keys.md'), `${SECRET}\n`);
  return { root, notes };
}

before(async () => {
  state.compileOutput = compile();
  if (state.compileOutput) return;
  const entry = path.join(dir, 'dist', 'main.js');
  if (!existsSync(entry)) {
    state.connectError = 'dist/main.js was not produced. Keep src/main.ts and outDir "dist".';
    return;
  }
  state.tmp = makeNotes();
  try {
    const require = createRequire(path.join(dir, 'package.json'));
    const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
    const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
    state.transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', NOTES_DIR: state.tmp.notes },
      stderr: 'pipe',
    });
    state.transport.stderr?.on('data', (d) => {
      state.stderr = (state.stderr + d).slice(-2000);
    });
    state.client = new Client({ name: 'checks', version: '1.0.0' });
    await state.client.connect(state.transport, { timeout: 10_000 });
  } catch (error) {
    state.connectError = `${String(error?.message ?? error).slice(0, 800)}${state.stderr ? `\nServer stderr:\n${state.stderr}` : ''}`;
  }
});

after(async () => {
  await state.client?.close().catch(() => {});
  if (state.tmp) rmSync(state.tmp.root, { recursive: true, force: true });
});

function ready() {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(
    !state.connectError,
    `Could not connect to the server over stdio: ${state.connectError}\nIf the handshake times out, check that nothing but protocol messages is written to stdout (use console.error for logs).`,
  );
  return state.client;
}

const call = (client, args) => client.callTool({ name: 'search_notes', arguments: args }, undefined, { timeout: 5000 });
const textOf = (result) => (result?.content ?? []).map((c) => c.text ?? '').join('\n');

/** Calls a tool and returns either the result or the thrown protocol error. */
async function attempt(fn) {
  try {
    return { result: await fn() };
  } catch (error) {
    return { error };
  }
}

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('handshake: the server starts over stdio and identifies itself as "notes"', () => {
  const client = ready();
  const info = client.getServerVersion();
  assert.equal(info?.name, 'notes', `The server should be named "notes", got ${JSON.stringify(info?.name)}`);
  const caps = client.getServerCapabilities() ?? {};
  assert.ok(caps.tools, 'The server must declare the tools capability (register a tool).');
  assert.ok(caps.resources, 'The server must declare the resources capability (register a resource).');
});

test('tool-definition: search_notes is listed with a description, a schema that requires query, and a read-only hint', async () => {
  const client = ready();
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'search_notes');
  assert.ok(tool, `Expected a tool named search_notes, found: ${tools.map((t) => t.name).join(', ') || 'none'}`);
  assert.ok((tool.description ?? '').length >= 20, 'Give search_notes a description that tells the model when to use it.');
  assert.deepEqual(tool.inputSchema?.required, ['query'], `Only "query" should be required, found ${JSON.stringify(tool.inputSchema?.required)}`);
  assert.equal(tool.inputSchema?.properties?.query?.type, 'string', 'query must be a string in the input schema.');
  assert.equal(tool.inputSchema?.properties?.limit?.type, 'integer', 'limit must be an integer in the input schema.');
  assert.equal(tool.annotations?.readOnlyHint, true, 'Mark search_notes as read-only (annotations.readOnlyHint: true), so hosts can run it without asking.');
});

test('tool-search: search_notes finds notes by text or name, case-insensitively, and honours limit', async () => {
  const client = ready();
  const result = await call(client, { query: 'migrations' });
  assert.notEqual(result.isError, true, `search_notes returned an error: ${textOf(result)}`);
  const names = (result.structuredContent?.results ?? []).map((r) => r.name).sort();
  assert.deepEqual(names, ['deploy', 'standup'], `query "migrations" should match deploy and standup, got ${JSON.stringify(names)}`);
  for (const r of result.structuredContent.results) assert.equal(typeof r.snippet, 'string', 'Each result needs a snippet string.');
  assert.ok(textOf(result).includes('deploy'), 'Also describe the results in the text content, for hosts that ignore structuredContent.');

  const byName = await call(client, { query: 'SHOPPING' });
  assert.deepEqual(byName.structuredContent?.results?.map((r) => r.name), ['shopping-list'], 'A query that matches a note name should find that note.');

  const many = await call(client, { query: 'daily log' });
  assert.equal(many.structuredContent?.results?.length, 5, `Without limit, return at most 5 results; got ${many.structuredContent?.results?.length}`);
  const three = await call(client, { query: 'daily log', limit: 3 });
  assert.equal(three.structuredContent?.results?.length, 3, `With limit 3, return 3 results; got ${three.structuredContent?.results?.length}`);

  const none = await call(client, { query: 'kubernetes' });
  assert.notEqual(none.isError, true, 'No matches is a normal result, not an error.');
  assert.deepEqual(none.structuredContent?.results, [], 'No matches should give results: [].');
  assert.ok(
    !JSON.stringify([result, byName, many, none]).includes('not Markdown'),
    'Only .md files are notes. A .txt file was searched.',
  );
});

test('tool-validation: bad arguments are rejected without running the search, and the server keeps working', async () => {
  const client = ready();
  for (const [args, what] of [
    [{}, 'no query'],
    [{ query: '' }, 'an empty query'],
    [{ query: 'x'.repeat(101) }, 'a query of 101 characters'],
    [{ query: 42 }, 'a number as the query'],
    [{ query: 'deploy', limit: 0 }, 'limit 0'],
    [{ query: 'deploy', limit: 11 }, 'limit 11'],
    [{ query: 'deploy', limit: 2.5 }, 'limit 2.5'],
  ]) {
    const { result, error } = await attempt(() => call(client, args));
    assert.ok(error || result?.isError === true, `search_notes with ${what} should be rejected, but it returned: ${textOf(result).slice(0, 200)}`);
  }
  const ok = await call(client, { query: 'deploy', limit: 10 });
  assert.notEqual(ok.isError, true, 'After rejected calls, a valid call (limit 10 is allowed) must still work.');
});

test('resources: every .md note is listed as note://<name> and can be read', async () => {
  const client = ready();
  const { resources } = await client.listResources();
  const uris = resources.map((r) => r.uri).sort();
  assert.ok(uris.includes('note://deploy') && uris.includes('note://shopping-list'), `Expected note://deploy and note://shopping-list, got ${uris.slice(0, 6).join(', ')}`);
  assert.equal(uris.length, 15, `Expected the 15 .md notes and nothing else, got ${uris.length}`);
  const read = await client.readResource({ uri: 'note://deploy' });
  assert.ok(read.contents?.[0]?.text?.includes('Run the database migrations'), 'Reading note://deploy must return the note text.');
  assert.equal(read.contents[0].uri, 'note://deploy', 'The content must carry the uri that was read.');
});

test('path-safety: resource names cannot reach files outside NOTES_DIR', async () => {
  const client = ready();
  const attempts = [
    'note://../secret',
    'note://..%2Fsecret',
    'note://%2E%2E%2Fsecret',
    'note://..%2F..%2Fsecret',
    'note://..%2Fnotes-private%2Fkeys',
    `note://${encodeURIComponent(path.join(state.tmp.root, 'secret'))}`,
    'note://not-a-note',
    'note://missing',
  ];
  for (const uri of attempts) {
    const { result } = await attempt(() => client.readResource({ uri }, { timeout: 5000 }));
    assert.ok(!JSON.stringify(result ?? {}).includes(SECRET), `Reading ${uri} returned a file from outside the notes folder.`);
  }
  const still = await client.readResource({ uri: 'note://standup' });
  assert.ok(still.contents?.[0]?.text?.includes('Standup'), 'After rejected reads, the server must still serve notes.');
});
