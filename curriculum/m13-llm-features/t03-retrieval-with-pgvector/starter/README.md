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

Replace this section with two short answers:

1. A question your users might ask that this vector search would answer badly, and what you would add (for example full-text search) to fix it.
2. How you would choose the minimum score of 0.3 for a real embedding model.
