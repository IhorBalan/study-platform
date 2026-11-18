# Help-centre retrieval with pgvector

Retrieval for a multi-tenant help assistant: chunk documents, store their embeddings in Postgres with pgvector, search them per tenant, and answer with citations. Read the task brief first.

```sh
npm install
pnpm lab up postgres                                   # from the study platform, publishes port 55432
docker exec study-lab-postgres-1 createdb -U lab rag_dev
export DATABASE_URL=postgres://lab:lab@localhost:55432/rag_dev
npm test
```

`src/fake-embedding.ts` is a deterministic stand-in for an embedding model: it hashes words into 64 buckets, so texts that share words score as similar. Use it for local runs and tests. To try a real local embedding model instead, `ollama pull nomic-embed-text` gives 768-dimensional vectors through `createOpenAICompatible(...).embeddingModel('nomic-embed-text')`; that needs a `vector(768)` column.

## Your notes

1. "What does error E-4012 mean?" Error codes, SKUs and product names carry meaning as exact tokens, which embedding models capture poorly. I would add a generated `tsvector` column with a GIN index, run a full-text query next to the vector query, and merge both rankings with reciprocal rank fusion.
2. Collect 50 to 100 real questions, label which chunks answer them (and a set of questions the documents cannot answer), then look at the score distributions of relevant and irrelevant hits. Pick the threshold that keeps almost all relevant hits while rejecting most unanswerable questions, and re-check it whenever the embedding model changes, because scores are not comparable across models.
