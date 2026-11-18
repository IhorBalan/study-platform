export interface Article {
  id: string;
  title: string;
  author: string;
  /** ISO 8601 timestamp in UTC, for example "2026-10-01T08:00:00.000Z". */
  createdAt: string;
}

export interface CreateArticleInput {
  title: string;
  author: string;
}
