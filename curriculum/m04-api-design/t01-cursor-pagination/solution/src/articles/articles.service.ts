import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Article, CreateArticleInput } from './article.js';
import type { Cursor } from './cursor.js';
import { SEED_ARTICLES } from './seed.js';

export interface PageQuery {
  limit: number;
  after?: Cursor;
  author?: string;
}

/** Newest first; id breaks ties so that every article has exactly one position. */
function compareDesc(a: Cursor, b: Cursor): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

@Injectable()
export class ArticlesService {
  private readonly articles = new Map<string, Article>(SEED_ARTICLES.map((a) => [a.id, { ...a }]));

  /**
   * One page in (createdAt DESC, id DESC) order. In SQL this is
   * WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT $3 + 1.
   * Asking for one extra row tells us whether another page exists.
   */
  page({ limit, after, author }: PageQuery): { items: Article[]; hasMore: boolean } {
    const rows = [...this.articles.values()]
      .filter((a) => author === undefined || a.author === author)
      .filter((a) => after === undefined || compareDesc(a, after) > 0)
      .sort(compareDesc)
      .slice(0, limit + 1);
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  create(input: CreateArticleInput): Article {
    const article: Article = {
      id: `art-${randomUUID()}`,
      title: input.title,
      author: input.author,
      createdAt: new Date().toISOString(),
    };
    this.articles.set(article.id, article);
    return article;
  }

  remove(id: string): boolean {
    return this.articles.delete(id);
  }
}
