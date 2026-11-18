A project management SaaS wants its help assistant to answer from each customer's own help-centre articles. Build the retrieval half on Postgres with pgvector: chunk, embed, store, search per tenant, and answer with citations that can be trusted.

## Requirements

Edit `src/rag.ts` and keep its exports. The database comes from `DATABASE_URL`; every function takes a `pg.Pool`. Models are parameters: an `EmbeddingModel` and a `LanguageModel` from `ai`. Use `embed`/`embedMany` and `generateText`.

- **`migrate(db)`** creates the `vector` extension and a table `doc_chunks` with at least `tenant_id`, `document_id`, `title`, `chunk_index`, `content` and `embedding vector(64)`, plus an HNSW index for cosine distance. It must succeed when run twice.
- **`chunkText(text, maxChars = 800)`** returns the chunks of a text. No chunk is longer than `maxChars` or empty. Joined together, the chunks contain every word of the text once, in order (no overlap, no split words). A paragraph (text between blank lines) that fits in `maxChars` is never split. You may assume no single word is longer than `maxChars`.
- **`ingestDocument(db, model, { tenantId, documentId, title, text })`** chunks with the default `maxChars`, embeds the chunks in batches, and stores them with `chunk_index` counting from 0. Ingesting the same `tenantId` and `documentId` again replaces the old chunks. It returns the number of chunks.
- **`search(db, model, { tenantId, query, k = 5, minScore = 0.3 })`** returns up to `k` hits of that tenant only, as `{ documentId, title, chunkIndex, content, score }`, where `score` is cosine similarity (`1 - distance`), best first, and below `minScore` dropped.
- **`answerQuestion(db, embeddingModel, chatModel, { tenantId, question })`** searches with `k = 4`. With no hits it returns `{ answer: NO_ANSWER, citations: [] }` without calling the chat model. Otherwise it sends the numbered sources and the question, returns the model's text as `answer`, and turns each `[n]` marker in it that refers to a source it sent into a citation `{ documentId, title, chunkIndex }`: once each, in order of first use.

## Tests

Write tests in `test/*.test.mjs`, importing from `../dist/rag.js`. They must pass, and fail against a copy whose `chunkText` returns chunks longer than `maxChars`.

## Submission

`src/`, `test/` and `README.md` with its two questions answered.

## What is checked

The checks run `migrate` twice on an empty database, read the column type, the index definition and a query plan, test `chunkText` on several limits, ingest documents for two tenants with a deterministic 64-dimension embedding model, compare stored vectors, search, and answer with a scripted chat model that cites a source that does not exist. Then they run your tests against your code and the broken copy.
