// Checks for "Cursor pagination for an articles feed". Node built-ins only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const state = { compileOutput: null, loadError: null, AppModule: null, NestFactory: null };

// The same data as src/articles/seed.ts, rebuilt here so the checks do not
// depend on the submission's copy.
const AUTHORS = ['ada', 'grace', 'linus', 'margaret'];
const BASE = Date.UTC(2026, 9, 1, 8, 0, 0);
const HOUR = 60 * 60 * 1000;
const SEED = Array.from({ length: 75 }, (_, k) => {
  const n = ((k * 37) % 75) + 1;
  return {
    id: `art-${String(n).padStart(3, '0')}`,
    author: AUTHORS[(n * 7) % AUTHORS.length],
    createdAt: new Date(BASE + Math.floor(n / 3) * HOUR).toISOString(),
  };
});
const byNewest = (a, b) =>
  a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1;
const EXPECTED = [...SEED].sort(byNewest).map((a) => a.id);

async function importFromSubmission(specifier) {
  const require = createRequire(path.join(dir, 'package.json'));
  return import(pathToFileURL(require.resolve(specifier)).href);
}

function compile() {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  if (!existsSync(path.join(dir, 'tsconfig.json'))) return 'tsconfig.json is missing from the submission.';
  if (!existsSync(tsc)) return 'node_modules/.bin/tsc was not found in the submission directory.';
  rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status === 0) return null;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return output.slice(0, 4000) || `tsc exited with status ${result.status}`;
}

before(async () => {
  state.compileOutput = compile();
  if (state.compileOutput) return;
  try {
    const entry = path.join(dir, 'dist', 'app.module.js');
    if (!existsSync(entry)) throw new Error('dist/app.module.js was not produced. Keep src/app.module.ts and outDir "dist".');
    await importFromSubmission('reflect-metadata');
    state.NestFactory = (await importFromSubmission('@nestjs/core')).NestFactory;
    state.AppModule = (await import(pathToFileURL(entry).href)).AppModule;
    if (typeof state.AppModule !== 'function') throw new Error('src/app.module.ts must export a class named AppModule.');
  } catch (error) {
    state.loadError = String(error?.message ?? error).slice(0, 1500);
  }
});

/** Creates a fresh app (fresh store) for one test and always closes it. */
async function withApp(fn) {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.loadError, `The app could not be loaded: ${state.loadError}`);
  const app = await state.NestFactory.create(state.AppModule, { logger: false, abortOnError: false });
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  try {
    return await fn(base);
  } finally {
    await app.close();
  }
}

async function call(base, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, type: res.headers.get('content-type') ?? '', text, json };
}

const show = (res) => res.text.slice(0, 200) || '(empty body)';

/** GET /articles with the given query and checks the page shape. */
async function getPage(base, query) {
  const qs = new URLSearchParams(query).toString();
  const url = `/articles${qs ? `?${qs}` : ''}`;
  const res = await call(base, 'GET', url);
  assert.equal(res.status, 200, `GET ${url}: expected status 200, got ${res.status}: ${show(res)}`);
  assert.ok(
    res.json && typeof res.json === 'object' && Array.isArray(res.json.items),
    `GET ${url}: expected a JSON object with an "items" array, got: ${show(res)}`,
  );
  assert.ok(
    'nextCursor' in res.json && (res.json.nextCursor === null || typeof res.json.nextCursor === 'string'),
    `GET ${url}: expected "nextCursor" to be a string or null, got: ${JSON.stringify(res.json.nextCursor)}`,
  );
  return { url, ids: res.json.items.map((a) => a?.id), items: res.json.items, nextCursor: res.json.nextCursor };
}

/** Follows nextCursor until it is null. Returns every page. */
async function walk(base, query, maxPages = 40) {
  const pages = [];
  let cursor;
  do {
    const page = await getPage(base, cursor === undefined ? query : { ...query, cursor });
    pages.push(page);
    cursor = page.nextCursor ?? undefined;
    assert.ok(pages.length <= maxPages, `Following nextCursor did not end after ${maxPages} pages`);
  } while (cursor !== undefined);
  return pages;
}

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('first-page: GET /articles returns the 20 newest articles with ties broken by id', async () => {
  await withApp(async (base) => {
    const page = await getPage(base, {});
    assert.equal(page.ids.length, 20, `GET /articles with no limit: expected 20 items, got ${page.ids.length}`);
    assert.deepEqual(
      page.ids,
      EXPECTED.slice(0, 20),
      'GET /articles: the items are not in the expected order (createdAt descending, then id descending)',
    );
    const first = page.items[0];
    for (const field of ['id', 'title', 'author', 'createdAt']) {
      assert.ok(field in first, `GET /articles: each item must keep the "${field}" field`);
    }
    assert.equal(typeof page.nextCursor, 'string', 'GET /articles: more articles exist, so nextCursor must be a string');
  });
});

test('walks-all: following nextCursor visits every article exactly once, in order', async () => {
  await withApp(async (base) => {
    const pages = await walk(base, { limit: '10' });
    const ids = pages.flatMap((p) => p.ids);
    assert.equal(new Set(ids).size, ids.length, 'Following nextCursor with limit=10 returned some articles twice');
    assert.deepEqual(ids, EXPECTED, 'Following nextCursor with limit=10 did not return all 75 articles in order');
    assert.equal(pages.length, 8, `75 articles with limit=10 should take 8 pages, took ${pages.length}`);
    for (const page of pages.slice(0, -1)) {
      assert.equal(page.ids.length, 10, `${page.url}: expected 10 items on a page that is not the last, got ${page.ids.length}`);
    }
  });
});

test('no-empty-last-page: nextCursor is null on the last page, even when the total divides evenly', async () => {
  await withApp(async (base) => {
    const pages = await walk(base, { limit: '25' });
    assert.equal(
      pages.length,
      3,
      `75 articles with limit=25 should take exactly 3 requests; got ${pages.length} (the third page must already say nextCursor: null)`,
    );
    assert.equal(pages[2].ids.length, 25, `The third page with limit=25 should hold 25 items, got ${pages[2].ids.length}`);
  });
});

test('limit-bounds: limit defaults to 20, accepts 1 to 100 and rejects anything else with 400', async () => {
  await withApp(async (base) => {
    assert.equal((await getPage(base, { limit: '1' })).ids.length, 1, 'GET /articles?limit=1 should return 1 item');
    const big = await getPage(base, { limit: '100' });
    assert.equal(big.ids.length, 75, 'GET /articles?limit=100 should return all 75 articles');
    assert.equal(big.nextCursor, null, 'GET /articles?limit=100 returns everything, so nextCursor must be null');
    for (const bad of ['0', '101', '-5', 'abc', '2.5', '']) {
      const res = await call(base, 'GET', `/articles?limit=${encodeURIComponent(bad)}`);
      assert.equal(res.status, 400, `GET /articles?limit=${bad}: expected status 400, got ${res.status}`);
    }
  });
});

test('opaque-cursor: the cursor is an opaque string and an invalid one is rejected with 400', async () => {
  await withApp(async (base) => {
    const page = await getPage(base, { limit: '5' });
    const cursor = page.nextCursor;
    assert.ok(!/^\d+$/.test(cursor), `nextCursor should be opaque, not a plain number (an offset in disguise); got "${cursor}"`);
    assert.ok(!cursor.includes(page.ids.at(-1)), `nextCursor should be opaque: it contains the raw id "${page.ids.at(-1)}"`);
    const bad = ['not-a-cursor', Buffer.from('{}').toString('base64url'), Buffer.from('[1,2]').toString('base64url'), '5'];
    for (const value of bad) {
      const res = await call(base, 'GET', `/articles?cursor=${encodeURIComponent(value)}`);
      assert.equal(res.status, 400, `GET /articles?cursor=${value}: expected status 400 for a cursor the server never issued, got ${res.status}`);
    }
  });
});

test('stable-under-inserts: articles created between two page requests cause no duplicates and no gaps', async () => {
  await withApp(async (base) => {
    const first = await getPage(base, { limit: '10' });
    assert.deepEqual(first.ids, EXPECTED.slice(0, 10), 'The first page with limit=10 is not in the expected order');
    for (let i = 0; i < 5; i += 1) {
      const res = await call(base, 'POST', '/articles', { title: `Breaking news ${i}`, author: 'ada' });
      assert.equal(res.status, 201, `POST /articles: expected status 201, got ${res.status}`);
    }
    const rest = await walk(base, { limit: '10', cursor: first.nextCursor });
    const ids = rest.flatMap((p) => p.ids);
    assert.deepEqual(
      ids,
      EXPECTED.slice(10),
      'After 5 new articles were created, following the cursor from page 1 should continue exactly where page 1 ended. It repeated or skipped articles.',
    );
  });
});

test('survives-deletes: deleting the last article of a page does not break or shift the next page', async () => {
  await withApp(async (base) => {
    const first = await getPage(base, { limit: '10' });
    for (const id of [first.ids.at(-1), first.ids[0]]) {
      const res = await call(base, 'DELETE', `/articles/${id}`);
      assert.equal(res.status, 204, `DELETE /articles/${id}: expected status 204, got ${res.status}`);
    }
    const second = await getPage(base, { limit: '10', cursor: first.nextCursor });
    assert.deepEqual(
      second.ids,
      EXPECTED.slice(10, 20),
      'After deleting two articles from page 1 (including the one the cursor points after), page 2 should still be articles 11 to 20',
    );
  });
});

test('filter-by-author: ?author= narrows the list and works together with the cursor', async () => {
  await withApp(async (base) => {
    const expected = [...SEED].filter((a) => a.author === 'grace').sort(byNewest).map((a) => a.id);
    const pages = await walk(base, { author: 'grace', limit: '7' });
    const ids = pages.flatMap((p) => p.ids);
    assert.deepEqual(ids, expected, 'Following nextCursor with author=grace&limit=7 should return exactly grace\'s articles, newest first');
    const none = await getPage(base, { author: 'nobody' });
    assert.deepEqual(none.ids, [], 'GET /articles?author=nobody: expected an empty items array');
    assert.equal(none.nextCursor, null, 'GET /articles?author=nobody: expected nextCursor null');
  });
});

test('errors-are-problems: a 400 is an application/problem+json document', async () => {
  await withApp(async (base) => {
    for (const url of ['/articles?limit=0', '/articles?cursor=not-a-cursor']) {
      const res = await call(base, 'GET', url);
      assert.equal(res.status, 400, `GET ${url}: expected status 400, got ${res.status}`);
      assert.match(res.type, /^application\/problem\+json/, `GET ${url}: expected Content-Type application/problem+json, got "${res.type}"`);
      assert.equal(res.json?.status, 400, `GET ${url}: the problem document should have "status": 400, got: ${show(res)}`);
      assert.equal(typeof res.json?.title, 'string', `GET ${url}: the problem document should have a "title" string, got: ${show(res)}`);
    }
  });
});
