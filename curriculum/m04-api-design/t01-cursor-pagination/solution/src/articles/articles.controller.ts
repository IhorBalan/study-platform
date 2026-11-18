import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { Article, CreateArticleInput } from './article.js';
import { ArticlesService } from './articles.service.js';
import { decodeCursor, encodeCursor } from './cursor.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface ArticlePage {
  items: Article[];
  nextCursor: string | null;
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const limit = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(limit >= 1 && limit <= MAX_LIMIT)) {
    throw new BadRequestException(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  list(
    @Query('limit') rawLimit?: string,
    @Query('cursor') rawCursor?: string,
    @Query('author') author?: string,
  ): ArticlePage {
    const limit = parseLimit(rawLimit);
    const after = rawCursor === undefined ? undefined : decodeCursor(rawCursor);
    if (rawCursor !== undefined && !after) throw new BadRequestException('cursor is not valid');

    const { items, hasMore } = this.articles.page({ limit, after, author });
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
  }

  @Post()
  create(@Body() input: CreateArticleInput): Article {
    return this.articles.create(input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    if (!this.articles.remove(id)) throw new NotFoundException(`Article ${id} not found`);
  }
}
