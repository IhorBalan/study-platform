---
title: "Full-text search in Postgres"
skills: [postgres-full-text-search]
---

Every product eventually gets a search box. The first version is `where title ilike '%' || $1 || '%'`, and it disappoints quickly: it cannot use a B-tree index, "running" does not find "run", and the results come back in no useful order. Postgres has real full-text search built in, with stemming, ranking and index support. It is enough for many products, and knowing its limits tells you when a separate search engine is worth its cost.

## Documents and queries

Full-text search works on two types:

- `tsvector`, a **document**: a sorted list of normalised words (lexemes) with their positions.
- `tsquery`, a **query**: lexemes combined with `&` (and), `|` (or), `!` (not) and `<->` (followed by).

```sql
select to_tsvector('english', 'The runners were running quickly');
-- 'quick':5 'run':4 'runner':2
```

The `english` configuration lower-cases, drops stop words such as "the" and "were", and reduces words to stems: "running" becomes `run`, "quickly" becomes `quick`. The match operator is `@@`:

```sql
select to_tsvector('english', 'The runners were running') @@ to_tsquery('english', 'run');   -- true
```

Always pass the configuration explicitly. Without it, Postgres uses the server's `default_text_search_config`, which may differ between your laptop and production, and documents and queries stemmed differently do not match.

## Parsing user input

Never feed raw user input to `to_tsquery`: it expects operator syntax and raises an error on input like `pasta & (`. Use one of the forgiving parsers:

- `plainto_tsquery('english', 'fast postgres')` joins all words with `&`.
- `websearch_to_tsquery('english', 'docker OR "b-tree" -pasta')` understands the syntax people type into search engines: quotes for phrases, `OR`, and `-` to exclude. It never raises a syntax error. This is the one to use for a search box.

For prefix matching, as in search-as-you-type, `to_tsquery('english', 'postg:*')` matches every lexeme starting with `postg`. Build that string from sanitised input yourself.

## Store the document and index it

Computing `to_tsvector` for every row on every search means a full scan. Store the document in a generated column and put a GIN index on it:

```sql
create table articles (
  id     bigint generated always as identity primary key,
  title  text not null,
  body   text not null,
  search tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', body), 'B')
  ) stored
);
create index articles_search_idx on articles using gin (search);
```

The generated column is recomputed on every insert and update, so it cannot drift from the text. Write `stored` explicitly: in PostgreSQL 18 generated columns are virtual by default, and a virtual column cannot be indexed.

GIN is an inverted index: for each lexeme it lists the rows that contain it, so a search reads only the matching rows. An expression index, `create index on articles using gin (to_tsvector('english', title || ' ' || body))`, also works without a column, but then every query must repeat exactly the same expression.

If the searchable text comes from several tables (a product and its brand and category names), a generated column cannot reach them. Maintain the column from application code or a trigger, or search a materialised view that is refreshed on a schedule.

## Ranking

A match is yes or no; ranking decides the order.

```sql
select id, title, ts_rank(search, q) as rank
from articles, websearch_to_tsquery('english', 'postgres run') as q
where search @@ q
order by rank desc
limit 20;
```

- `ts_rank` scores by how often the query's lexemes occur, multiplied by their weights. `setweight` above labelled title words `A` and body words `B`, so a match in the title counts more.
- `ts_rank_cd` (cover density) also rewards query words that appear close together.
- Both can normalise by document length, so a long document does not win merely by repeating words.

Ranking has to compute a score for every matching row before it can sort. For a common word across millions of rows that is expensive; the index finds matches quickly but cannot return them in rank order. Keep the matched set small with other filters (a tenant, a category, a date range) or accept a cap.

`ts_headline` returns a snippet with the matched words highlighted. It re-parses the original text and is slow, so call it only on the rows you return, after the `limit`.

## Fuzzy matching with pg_trgm

Full-text search matches words, not spelling. "Postgress" finds nothing. The `pg_trgm` extension compares strings by their three-letter sequences (trigrams):

```sql
create extension if not exists pg_trgm;
create index products_name_trgm_idx on products using gin (name gin_trgm_ops);

select name from products where name % 'postgress' order by similarity(name, 'postgress') desc limit 5;
select name from products where name ilike '%gres%';   -- this can use the trigram index too
```

Trigrams suit short fields, such as names, titles, SKUs and email addresses, and handle typos and substring search. Full-text search suits longer prose. Many search boxes combine them: full-text for matching and ranking, trigrams as a "did you mean" fallback when nothing matches.

## When to move to a search engine

Postgres full-text search covers a search box over a few million rows in one or a few languages, combined with ordinary SQL filters, and with no extra system to run. Consider a dedicated engine (Elasticsearch or OpenSearch, or the lighter Meilisearch or Typesense) when you need several of these:

- **Relevance tuning** beyond weights: synonyms, boosting by popularity or recency, learning from clicks.
- **Typo tolerance and search-as-you-type** across large text, with millisecond latency.
- **Facets**: counts per brand, price band and colour next to every result list, over large result sets.
- **Many languages** in one index, with language detection.
- **Search load isolation**, so heavy search traffic cannot slow down transactional queries.

The cost is real. You run and monitor another stateful system, and you keep it in sync: every write to Postgres must reach the index, usually through an outbox table or change data capture, and search results become eventually consistent. Permissions are duplicated too: a search engine does not know which rows a user may see. Start with Postgres, measure, and move when a concrete requirement on that list appears.

For search by meaning rather than by words ("cheap flights" finding "budget airfare"), you need vector embeddings. Postgres handles those with the pgvector extension, which a later module covers.

## Common mistakes

- `ilike '%term%'` over a large table with no trigram index.
- `to_tsquery` on raw user input, which raises errors on ordinary text.
- Omitting the text search configuration, so documents and queries are stemmed differently.
- Computing `to_tsvector` per query instead of storing and indexing it.
- Calling `ts_headline` on every matched row instead of only the returned ones.
- Moving to a search engine before measuring what Postgres can do.

## Go deeper

- [PostgreSQL: Full text search](https://www.postgresql.org/docs/current/textsearch.html): the whole chapter.
- [PostgreSQL: Controlling text search](https://www.postgresql.org/docs/current/textsearch-controls.html): parsing queries, ranking and headlines.
- [PostgreSQL: Preferred index types for text search](https://www.postgresql.org/docs/current/textsearch-indexes.html): GIN versus GiST.
- [PostgreSQL: pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html): similarity operators and trigram indexes.
