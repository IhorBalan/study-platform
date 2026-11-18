import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Article, CreateArticleInput } from './article.js';
import { SEED_ARTICLES } from './seed.js';

/**
 * Holds the articles in memory. Each instance starts from the seed, so every
 * app created from AppModule has its own copy.
 */
@Injectable()
export class ArticlesService {
  private readonly articles = new Map<string, Article>(SEED_ARTICLES.map((a) => [a.id, { ...a }]));

  // TODO: replace this with a method that returns one page, newest first,
  // using a keyset (createdAt, id) instead of an offset.
  all(): Article[] {
    return [...this.articles.values()];
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
