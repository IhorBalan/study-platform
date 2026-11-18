import type { EmbeddingModel, LanguageModel } from 'ai';
import type pg from 'pg';

/** Must match the embedding model. Changing models means a new column and a full re-embed. */
export const EMBEDDING_DIMENSIONS = 64;
export const NO_ANSWER = 'I could not find this in your documents.';

type Db = pg.Pool;

export interface Hit {
  documentId: string;
  title: string;
  chunkIndex: number;
  content: string;
  score: number;
}

/** Creates the extension, the doc_chunks table and its indexes. Safe to run more than once. */
export async function migrate(db: Db): Promise<void> {
  // TODO
  void db;
  throw new Error('Not implemented');
}

/** Splits a text into chunks of at most maxChars, keeping paragraphs whole where they fit. */
export function chunkText(text: string, maxChars = 800): string[] {
  // TODO
  void text;
  void maxChars;
  throw new Error('Not implemented');
}

/** Chunks, embeds and stores one document, replacing any earlier version. Returns the chunk count. */
export async function ingestDocument(
  db: Db,
  model: EmbeddingModel,
  doc: { tenantId: string; documentId: string; title: string; text: string },
): Promise<number> {
  // TODO
  void db;
  void model;
  void doc;
  throw new Error('Not implemented');
}

/** The tenant's chunks closest to the query, best first, with score = cosine similarity. */
export async function search(
  db: Db,
  model: EmbeddingModel,
  options: { tenantId: string; query: string; k?: number; minScore?: number },
): Promise<Hit[]> {
  // TODO: k defaults to 5, minScore to 0.3
  void db;
  void model;
  void options;
  throw new Error('Not implemented');
}

/** Answers from the tenant's documents and returns the sources the answer cites. */
export async function answerQuestion(
  db: Db,
  embeddingModel: EmbeddingModel,
  chatModel: LanguageModel,
  options: { tenantId: string; question: string },
): Promise<{ answer: string; citations: { documentId: string; title: string; chunkIndex: number }[] }> {
  // TODO
  void db;
  void embeddingModel;
  void chatModel;
  void options;
  throw new Error('Not implemented');
}
