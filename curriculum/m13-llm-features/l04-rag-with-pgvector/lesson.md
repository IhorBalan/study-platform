---
title: Embeddings and retrieval with pgvector
skills: [llm-rag]
---

A model knows nothing about your customer's help centre, contracts or tickets. You could paste all of it into every prompt, but it does not fit, it costs a fortune, and it leaks one customer's data to another. **Retrieval-augmented generation (RAG)** sends only the few passages that matter: you search your own data first, then ask the model to answer from what you found. The search part is a database problem, and Postgres with the pgvector extension handles it well at startup scale.

## Embeddings

An **embedding model** turns a text into a vector of numbers, for example 768 or 1,024 floats. Texts with similar meaning get vectors that point in similar directions. "How do I get my money back?" and "Refund policy" end up close together even though they share no words. That is the advantage over keyword search.

Closeness is usually measured by **cosine similarity**: 1 for the same direction, 0 for unrelated. pgvector's `<=>` operator returns cosine *distance*, which is `1 - similarity`.

With the AI SDK, `embed()` handles one value and `embedMany()` a batch:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed, embedMany } from 'ai';

const ollama = createOpenAICompatible({ name: 'ollama', baseURL: 'http://localhost:11434/v1' });
const model = ollama.embeddingModel('nomic-embed-text');

const { embeddings } = await embedMany({ model, values: chunks }); // one vector per chunk, same order
const { embedding } = await embed({ model, value: 'How long do refunds take?' });
```

`embedMany` splits large batches by the model's per-call limit and runs the calls for you. Calling `embed` once per chunk in a loop is slower and makes more requests against your rate limit.

Rules that save you a migration later:

- **Vectors from different models are not comparable.** Store which model produced them. Changing models means re-embedding everything.
- **The dimension is fixed per model**, and your column must match it.
- **Embed queries and documents with the same model.** Some models want a prefix such as `search_query:` or `search_document:`; read the model card.
- Anthropic does not offer an embedding model. With Claude for generation, teams use a separate embedding provider or a local model, which is perfectly normal.

## Chunking

You embed **chunks**, not whole documents. One vector for a 30-page document blurs everything together, and you could not send the whole document to the model anyway. Typical chunks are a few hundred to a thousand characters.

Good chunking follows the text's own structure. Split on paragraphs or headings first, and only split a long paragraph between sentences or words. Never cut through a word. Many pipelines add a small **overlap** (the end of one chunk repeated at the start of the next) so a sentence cut at a boundary still appears whole somewhere. Store the document id, title and position of every chunk: you need them for citations.

## The table and the index

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE doc_chunks (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL,
  document_id text NOT NULL,
  chunk_index integer NOT NULL,
  content     text NOT NULL,
  embedding   vector(768) NOT NULL, -- nomic-embed-text produces 768 dimensions
  UNIQUE (tenant_id, document_id, chunk_index)
);

CREATE INDEX ON doc_chunks USING hnsw (embedding vector_cosine_ops);
```

Without an index, a similarity query compares the query vector with every row. That is exact, and fine for tens of thousands of rows. **HNSW** is an approximate index: a layered graph that finds near neighbours in a fraction of the time, at the cost of occasionally missing one. pgvector's other index type, IVFFlat, builds faster but needs data in the table first and usually recalls less.

The operator class must match the operator in your queries. `vector_cosine_ops` serves `<=>`; `vector_l2_ops` serves `<->` (Euclidean); `vector_ip_ops` serves `<#>` (negative inner product). Index with one and query with another, and Postgres silently scans the whole table.

The `vector` type can be indexed with HNSW up to 2,000 dimensions. Larger models need `halfvec` (half-precision floats, up to 4,000 dimensions), or a model configured for fewer dimensions.

Re-ingesting a document should **replace** its chunks: delete the old rows and insert the new ones in one transaction. Otherwise an edited help article answers questions with its old text forever.

## Searching

```sql
SELECT document_id, chunk_index, content, 1 - (embedding <=> $2) AS score
  FROM doc_chunks
 WHERE tenant_id = $1
 ORDER BY embedding <=> $2
 LIMIT 5;
```

From Node with `pg`, pass the vector as text, `'[0.12,-0.03,...]'`, and Postgres casts it. Three things to get right:

- **Order by the distance expression itself** (`ORDER BY embedding <=> $2`), not by a computed alias or `score DESC`. Only that form can use the index.
- **Filter by tenant in the same query.** Retrieval is a data-access path like any other. A missing `WHERE tenant_id = $1` is a cross-tenant data leak, and the model will happily quote the other customer's document. With a filter, an HNSW scan can return fewer than `LIMIT` rows, because it finds the nearest neighbours first and filters after. pgvector 0.8 added iterative scans for this: `SET hnsw.iterative_scan = relaxed_order;` keeps scanning until enough rows pass the filter.
- **Apply a minimum score.** Top-k always returns k rows, even for "What is the weather on Mars?". Drop results below a threshold you tuned on real queries, and when nothing is left, say "I don't know" without calling the generation model at all. That is cheaper and more honest.

## Hybrid search

Embeddings are weak at exact tokens: error codes, product SKUs, names, version numbers. "E-4012" means nothing to most embedding models. Postgres full-text search (module 3, lesson 8) is strong exactly there. Run both and merge the rankings with **reciprocal rank fusion** (RRF), which only needs ranks, not comparable scores:

```sql
WITH semantic AS (
  SELECT id, row_number() OVER (ORDER BY embedding <=> $2) AS rank
    FROM doc_chunks WHERE tenant_id = $1
   ORDER BY embedding <=> $2 LIMIT 20
),
keyword AS (
  SELECT id, row_number() OVER (ORDER BY ts_rank_cd(search, q) DESC) AS rank
    FROM doc_chunks, websearch_to_tsquery('english', $3) AS q
   WHERE tenant_id = $1 AND search @@ q
   ORDER BY ts_rank_cd(search, q) DESC LIMIT 20
)
SELECT c.document_id, c.chunk_index, c.content,
       coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + k.rank), 0) AS rrf
  FROM semantic s
  FULL OUTER JOIN keyword k USING (id)
  JOIN doc_chunks c ON c.id = coalesce(s.id, k.id)
 ORDER BY rrf DESC
 LIMIT 5;
```

This assumes a generated column `search tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED` with a GIN index. The constant 60 is the conventional RRF damping value. A document ranked well by both searches beats one ranked first by only one.

## From hits to an answer, with citations

Number the retrieved chunks and put them in the user message, clearly marked as data:

```text
<source id="1" title="Refund policy">Refunds are issued within 5 business days...</source>
<source id="2" title="Annual plans">Annual plans can be refunded within 30 days...</source>

Question: How long do refunds take for annual plans?
```

The instructions tell the model to answer only from the sources and to cite them as `[1]`, `[2]`. Then check the citations in code. Keep markers that point at a source you actually sent, drop the rest (models do invent `[7]`), and map each one back to its document so the UI can link to it. Citations let users verify answers, and they let you measure whether answers are grounded (lesson 6).

## When RAG is the wrong tool

- **The data fits in the prompt.** A 20-page policy is cheaper to send in full, especially with prompt caching (lesson 5), and nothing gets lost in retrieval.
- **The question is structured.** "How many open invoices does Acme have?" is a SQL query. Give the model a tool that runs it.
- **The answer needs the whole corpus.** "Summarise all tickets from March" is a batch job over every ticket, not top-5 retrieval.
- **The data changes every second.** Fetch it live through a tool instead of keeping an index fresh.

## Common mistakes

- Mixing vectors from two embedding models in one column.
- An index operator class that does not match the query operator, so every search is a full scan.
- Forgetting the tenant filter in the similarity query.
- No minimum score, so unrelated questions get confident answers built from irrelevant chunks.
- Re-ingesting by inserting, so old versions of a document keep answering.
- Trusting the model's citation numbers without checking them against what you sent.
- Using RAG for questions a SQL query answers exactly.

## Go deeper

- [pgvector README](https://github.com/pgvector/pgvector): types, operators, HNSW and IVFFlat options, iterative scans and filtering.
- [AI SDK: Embeddings](https://ai-sdk.dev/docs/ai-sdk-core/embeddings): `embed`, `embedMany`, batching and similarity helpers.
- [PostgreSQL: Full text search](https://www.postgresql.org/docs/current/textsearch.html): the keyword half of hybrid search.
- [Claude API: Embeddings](https://platform.claude.com/docs/en/build-with-claude/embeddings): choosing an embedding provider to use alongside Claude.
