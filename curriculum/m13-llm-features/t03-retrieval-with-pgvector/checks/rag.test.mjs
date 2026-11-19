// Checks for "Retrieval with pgvector". Node built-ins only, plus `pg` and `ai/test` from the submission.
// Embeddings come from a deterministic hashing model defined below, and the chat model is scripted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const state = { compileOutput: null, loadError: null, migrateError: null, mod: null, pool: null, ai: null };

// ---------- deterministic embeddings (same idea as the starter's fake-embedding.ts) ----------

const DIMS = 64;
const STOP = new Set('a an and are as at be by do for from how i in is it my of on or the to what with you your can does this that'.split(' '));
function fnv1a(word) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    hash ^= word.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
function embedText(text) {
  const v = new Array(DIMS).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) if (!STOP.has(w)) v[fnv1a(w) % DIMS] += 1;
  const n = Math.hypot(...v);
  return n === 0 ? v.map((_, i) => (i === 0 ? 1 : 0)) : v.map((x) => x / n);
}
function embeddingModel(maxEmbeddingsPerCall = 16) {
  return new state.ai.MockEmbeddingModelV4({
    modelId: 'check-hash-64',
    maxEmbeddingsPerCall,
    doEmbed: async ({ values }) => ({ embeddings: values.map(embedText), usage: { tokens: values.length }, warnings: [] }),
  });
}
const usage = {
  inputTokens: { total: 50, noCache: 50, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};
function chatModel(answer) {
  return new state.ai.MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: 'text', text: answer }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }),
  });
}

// ---------- fixtures ----------

const DOCS = {
  refunds: {
    tenantId: 'acme',
    documentId: 'kb-refunds',
    title: 'Refund policy',
    text: 'Refunds are issued to the original payment method within 5 business days.\n\nAnnual plans can be refunded within 30 days of purchase.',
  },
  sso: {
    tenantId: 'acme',
    documentId: 'kb-sso',
    title: 'Single sign-on',
    text: 'Single sign-on works with any SAML 2.0 identity provider. Enterprise admins configure SSO under Settings, Security.',
  },
  export: {
    tenantId: 'acme',
    documentId: 'kb-export',
    title: 'Exporting projects',
    text: 'Projects can be exported as CSV or JSON from the project menu. Exports include tasks, comments and attachment links.',
  },
  // Another tenant, written to match the refund question even better than acme's own document.
  globex: {
    tenantId: 'globex',
    documentId: 'kb-refunds',
    title: 'Globex refunds',
    text: 'GLOBEX-CONFIDENTIAL: refunds take long for annual plans, refunds for annual plans take 90 days.',
  },
};

function longText() {
  const sentence = (i) => `Paragraph ${i} explains workspace setting number ${i} and why it matters for teams.`;
  return Array.from({ length: 8 }, (_, i) => Array.from({ length: 4 }, () => sentence(i)).join(' ')).join('\n\n');
}

// ---------- setup ----------

function compile() {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  if (!existsSync(path.join(dir, 'tsconfig.json'))) return 'tsconfig.json is missing from the submission.';
  if (!existsSync(tsc)) return 'node_modules/.bin/tsc was not found in the submission directory.';
  rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  if (result.status === 0) return null;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 4000) || `tsc exited with status ${result.status}`;
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for these checks.');
  state.compileOutput = compile();
  if (state.compileOutput) return;
  try {
    const require = createRequire(path.join(dir, 'package.json'));
    const pg = (await import(pathToFileURL(require.resolve('pg')).href)).default;
    state.ai = await import(pathToFileURL(require.resolve('ai/test')).href);
    state.pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    const entry = path.join(dir, 'dist', 'rag.js');
    if (!existsSync(entry)) throw new Error('dist/rag.js was not produced. Keep src/rag.ts and outDir "dist".');
    state.mod = await import(pathToFileURL(entry).href);
  } catch (error) {
    state.loadError = String(error?.message ?? error).slice(0, 1500);
    return;
  }
  try {
    await state.mod.migrate(state.pool);
    await state.mod.migrate(state.pool); // must be safe to run twice
  } catch (error) {
    state.migrateError = String(error?.message ?? error).slice(0, 1500);
  }
});

after(async () => {
  await state.pool?.end();
});

function ready({ needSchema = true } = {}) {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.loadError, `dist/rag.js could not be loaded: ${state.loadError}`);
  if (needSchema) assert.ok(!state.migrateError, `migrate() failed (it runs twice, so it must be idempotent): ${state.migrateError}`);
  return state.mod;
}

let seeded = null;
async function seed() {
  if (seeded) return seeded;
  const { ingestDocument } = ready();
  const model = embeddingModel();
  for (const doc of Object.values(DOCS)) await ingestDocument(state.pool, model, doc);
  seeded = true;
  return seeded;
}

const parseVector = (text) => text.slice(1, -1).split(',').map(Number);

// ---------- criteria ----------

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('schema: migrate() is idempotent and creates doc_chunks with a vector(64) column and an HNSW cosine index', async () => {
  ready();
  const col = await state.pool.query(
    `SELECT format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'doc_chunks' AND a.attname = 'embedding' AND NOT a.attisdropped`,
  );
  assert.equal(col.rows[0]?.type, 'vector(64)', `doc_chunks.embedding must be vector(64), found ${col.rows[0]?.type ?? 'no such column'}`);
  const idx = await state.pool.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'doc_chunks'`);
  const hnsw = idx.rows.map((r) => r.indexdef).find((d) => /USING hnsw/i.test(d));
  assert.ok(hnsw, `Expected an HNSW index on doc_chunks.embedding. Indexes found: ${idx.rows.map((r) => r.indexdef).join('; ') || 'none'}`);
  assert.match(hnsw, /vector_cosine_ops/, `The HNSW index must use vector_cosine_ops to serve cosine distance (<=>). Found: ${hnsw}`);
  const client = await state.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    const plan = await client.query(`EXPLAIN SELECT id FROM doc_chunks ORDER BY embedding <=> $1 LIMIT 5`, [`[${embedText('test').join(',')}]`]);
    const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
    assert.match(text, /Index Scan/i, `A cosine-distance query cannot use your index. Plan:\n${text}`);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('chunking: chunks keep every word in order, respect maxChars and keep short paragraphs whole', () => {
  const { chunkText } = ready({ needSchema: false });
  assert.deepEqual(chunkText('', 100), [], 'An empty text has no chunks.');
  assert.deepEqual(chunkText('  \n\n  ', 100), [], 'A text of only whitespace has no chunks.');
  const text = longText();
  for (const max of [120, 300, 800]) {
    const chunks = chunkText(text, max);
    assert.ok(Array.isArray(chunks) && chunks.length > 0, `chunkText(text, ${max}) returned no chunks.`);
    for (const c of chunks) {
      assert.ok(c.trim().length > 0, `chunkText(text, ${max}) returned an empty chunk.`);
      assert.ok(c.length <= max, `chunkText(text, ${max}) returned a chunk of ${c.length} characters.`);
    }
    const words = (s) => s.split(/\s+/).filter(Boolean);
    assert.deepEqual(
      words(chunks.join(' ')),
      words(text),
      `chunkText(text, ${max}): the chunks, joined, must contain every word of the text once, in order (no gaps, no overlap, no split words).`,
    );
    for (const para of text.split('\n\n')) {
      if (para.length <= max) {
        assert.ok(
          chunks.some((c) => c.replace(/\s+/g, ' ').includes(para)),
          `chunkText(text, ${max}): a paragraph of ${para.length} characters fits in one chunk but was split.`,
        );
      }
    }
  }
});

test('ingest: chunks are embedded in batches and stored with their own vectors, and re-ingesting replaces them', async () => {
  const { ingestDocument, chunkText } = ready();
  const model = embeddingModel(2);
  const doc = { tenantId: 'initech', documentId: 'kb-long', title: 'Workspace settings', text: longText() };
  const count = await ingestDocument(state.pool, model, doc);
  const expected = chunkText(doc.text);
  assert.equal(count, expected.length, `ingestDocument should return the number of chunks (${expected.length}), got ${count}`);
  assert.ok(expected.length >= 2, 'The test document should produce at least two chunks with the default maxChars.');
  assert.ok(
    model.doEmbedCalls.length <= Math.ceil(expected.length / 2),
    `Embed the chunks in batches (embedMany). ${expected.length} chunks with a limit of 2 per call need ${Math.ceil(expected.length / 2)} calls, you made ${model.doEmbedCalls.length}.`,
  );
  const { rows } = await state.pool.query(
    `SELECT chunk_index, content, title, embedding::text AS embedding FROM doc_chunks WHERE tenant_id = 'initech' AND document_id = 'kb-long' ORDER BY chunk_index`,
  );
  assert.equal(rows.length, expected.length, `Expected ${expected.length} rows for the document, found ${rows.length}`);
  rows.forEach((row, i) => {
    assert.equal(row.chunk_index, i, 'chunk_index must count from 0 in document order.');
    assert.equal(row.content, expected[i], `Row ${i} must store chunk ${i} as content.`);
    assert.equal(row.title, 'Workspace settings', 'Store the document title with each chunk.');
    const stored = parseVector(row.embedding);
    const want = embedText(expected[i]);
    assert.ok(stored.every((v, j) => Math.abs(v - want[j]) < 1e-4), `Row ${i}: the stored embedding is not the embedding of its own content.`);
  });

  await ingestDocument(state.pool, embeddingModel(), { ...doc, text: 'Short replacement text.' });
  const again = await state.pool.query(`SELECT content FROM doc_chunks WHERE tenant_id = 'initech' AND document_id = 'kb-long'`);
  assert.deepEqual(
    again.rows.map((r) => r.content),
    ['Short replacement text.'],
    'Ingesting the same document again must replace its old chunks, not add to them.',
  );
});

test('search: returns the closest chunks first with a score, honours k and drops weak matches', async () => {
  const { search } = ready();
  await seed();
  const hits = await search(state.pool, embeddingModel(), { tenantId: 'acme', query: 'How do I configure SAML single sign-on?' });
  assert.ok(Array.isArray(hits) && hits.length > 0, 'Expected at least one hit for a question that matches a document.');
  const top = hits[0];
  assert.equal(top.documentId, 'kb-sso', `The SSO document should rank first, got ${top.documentId}`);
  assert.equal(top.title, 'Single sign-on', 'Each hit must carry the document title.');
  assert.equal(top.chunkIndex, 0, 'Each hit must carry its chunkIndex.');
  assert.ok(top.content.includes('SAML 2.0'), 'Each hit must carry the chunk content.');
  const want = embedText('How do I configure SAML single sign-on?').reduce((s, v, i) => s + v * embedText(top.content)[i], 0);
  assert.ok(Math.abs(top.score - want) < 0.01, `score must be cosine similarity (1 - cosine distance): expected about ${want.toFixed(3)}, got ${top.score}`);
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score, 'Hits must be sorted by score, best first.');
  for (const h of hits) assert.ok(h.score >= 0.3, `A hit with score ${h.score} is below the default minScore of 0.3.`);

  const one = await search(state.pool, embeddingModel(), { tenantId: 'acme', query: 'refunds annual plans export projects CSV', k: 1, minScore: 0 });
  assert.equal(one.length, 1, `With k: 1, return at most one hit; got ${one.length}`);
  const none = await search(state.pool, embeddingModel(), { tenantId: 'acme', query: 'What is the weather on Mars tomorrow?' });
  assert.deepEqual(none, [], `A question unrelated to every document must return no hits, got ${JSON.stringify(none).slice(0, 200)}`);
});

test("tenant-isolation: a tenant never retrieves another tenant's chunks", async () => {
  const { search } = ready();
  await seed();
  const hits = await search(state.pool, embeddingModel(), { tenantId: 'acme', query: 'How long do refunds take for annual plans?', k: 10, minScore: 0 });
  assert.ok(hits.length > 0, 'Expected hits for the refund question.');
  assert.ok(!hits.some((h) => h.content.includes('GLOBEX')), "Tenant acme received a chunk that belongs to tenant globex.");
  assert.equal(hits[0].documentId, 'kb-refunds', `acme's own refund policy should rank first, got ${hits[0].documentId}`);
  const other = await search(state.pool, embeddingModel(), { tenantId: 'nobody', query: 'How long do refunds take for annual plans?', minScore: 0 });
  assert.deepEqual(other, [], 'A tenant with no documents must get no hits.');
});

test('grounded-answer: the model sees the retrieved sources and the question, and only valid citations are returned', async () => {
  const { answerQuestion } = ready();
  await seed();
  const chat = chatModel('Refunds take 5 business days [1]. Annual plans can be refunded within 30 days [1][7].');
  const result = await answerQuestion(state.pool, embeddingModel(), chat, { tenantId: 'acme', question: 'How long do refunds take for annual plans?' });
  assert.equal(chat.doGenerateCalls.length, 1, `Expected one call to the chat model, got ${chat.doGenerateCalls.length}`);
  const prompt = JSON.stringify(chat.doGenerateCalls[0].prompt);
  assert.ok(prompt.includes('within 5 business days'), 'The prompt must include the content of the retrieved chunks.');
  assert.ok(prompt.includes('How long do refunds take for annual plans?'), 'The prompt must include the question.');
  assert.ok(!prompt.includes('GLOBEX'), "Another tenant's text reached the model.");
  assert.equal(result?.answer, 'Refunds take 5 business days [1]. Annual plans can be refunded within 30 days [1][7].', 'Return the model text as answer.');
  assert.deepEqual(
    result.citations,
    [{ documentId: 'kb-refunds', title: 'Refund policy', chunkIndex: 0 }],
    `citations must list each source the answer cites, once, and ignore [7], which was never sent. Got ${JSON.stringify(result.citations)}`,
  );
});

test('grounded-answer: four sources reach the model, and citations come in order of first use', async () => {
  const { answerQuestion, ingestDocument } = ready();
  await seed();
  // Six documents that all match the question, each a little worse than the one before it.
  const question = 'webhook delivery retries signature';
  const extras = ['alpha', 'bravo charlie', 'delta echo foxtrot', 'golf hotel india juliet', 'kilo lima mike november oscar', 'papa quebec romeo sierra tango uniform'];
  const docs = extras.map((extra, i) => ({
    tenantId: 'hooli',
    documentId: `kb-hook-${i}`,
    title: `Webhooks ${i}`,
    text: `Webhook delivery retries signature MARK${i}X ${extra}.`,
  }));
  const model = embeddingModel();
  for (const doc of docs) await ingestDocument(state.pool, model, doc);
  const q = embedText(question);
  const ranked = docs
    .map((doc) => ({ doc, score: embedText(doc.text).reduce((sum, v, i) => sum + v * q[i], 0) }))
    .sort((x, y) => y.score - x.score);

  const chat = chatModel('Retries back off [3]. Each delivery is signed [1]. See also [3] and [9].');
  const result = await answerQuestion(state.pool, model, chat, { tenantId: 'hooli', question });
  const prompt = JSON.stringify(chat.doGenerateCalls[0]?.prompt ?? '');
  const sent = docs.filter((_, i) => prompt.includes(`MARK${i}X`)).map((doc) => doc.documentId);
  assert.deepEqual(
    sent.toSorted(),
    ranked.slice(0, 4).map((r) => r.doc.documentId).toSorted(),
    `answerQuestion must search with k = 4: six chunks match, and the four closest must reach the model. Sent: ${sent.join(', ')}`,
  );
  const cite = (r) => ({ documentId: r.doc.documentId, title: r.doc.title, chunkIndex: 0 });
  assert.deepEqual(
    result?.citations,
    [cite(ranked[2]), cite(ranked[0])],
    `The answer cites [3], then [1], then [3] again and [9]. citations must be source 3, then source 1: once each, in order of first use. Got ${JSON.stringify(result?.citations)}`,
  );
});

test('no-context: without relevant chunks the answer is NO_ANSWER and the chat model is not called', async () => {
  const { answerQuestion, NO_ANSWER } = ready();
  await seed();
  assert.equal(typeof NO_ANSWER, 'string', 'Keep the NO_ANSWER export.');
  const chat = chatModel('Probably sunny [1].');
  const result = await answerQuestion(state.pool, embeddingModel(), chat, { tenantId: 'acme', question: 'What is the weather on Mars tomorrow?' });
  assert.deepEqual(result, { answer: NO_ANSWER, citations: [] }, `Expected { answer: NO_ANSWER, citations: [] }, got ${JSON.stringify(result)}`);
  assert.equal(chat.doGenerateCalls.length, 0, 'The chat model was called although no chunk was relevant.');
});

// ---------- the learner's own tests ----------

function runTests(cwd) {
  // Without NODE_TEST_CONTEXT the nested run behaves like a top-level `node --test`.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...env, NODE_OPTIONS: '' },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// Broken on purpose: chunks may be three times longer than maxChars.
const LONG_CHUNKS = `
export function chunkText(text, maxChars = 800) {
  return real.chunkText(text, maxChars * 3);
}`;

test('own-tests: your tests pass and catch a chunkText that ignores maxChars', () => {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.mjs (node:test). None were found.');

  const own = runTests(dir);
  assert.equal(own.status, 0, `Your tests fail against your own code:\n${own.output.slice(-2000)}`);

  const target = mkdtempSync(path.join(dir, '.mutant-'));
  try {
    cpSync(testDir, path.join(target, 'test'), { recursive: true });
    cpSync(path.join(dir, 'dist'), path.join(target, 'dist'), { recursive: true });
    const real = pathToFileURL(path.join(dir, 'dist', 'rag.js')).href;
    writeFileSync(
      path.join(target, 'dist', 'rag.js'),
      [`import * as real from ${JSON.stringify(real)};`, `export * from ${JSON.stringify(real)};`, LONG_CHUNKS, ''].join('\n'),
    );
    const mutant = runTests(target);
    assert.notEqual(
      mutant.status,
      0,
      'Your tests still pass when chunkText returns chunks longer than maxChars. Add a test with a text that needs several chunks.',
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
