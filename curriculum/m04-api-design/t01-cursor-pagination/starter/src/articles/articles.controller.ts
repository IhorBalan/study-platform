import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import type { Article, CreateArticleInput } from './article.js';
import { ArticlesService } from './articles.service.js';

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  // TODO: accept ?limit=, ?cursor= and ?author=, and return
  // { items: Article[], nextCursor: string | null } as described in the brief.
  @Get()
  list(): Article[] {
    return this.articles.all();
  }

  // Input validation is not the point of this task, so this route trusts its body.
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
