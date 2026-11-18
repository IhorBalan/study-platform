import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ArticlesModule } from './articles/articles.module.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

@Module({
  imports: [ArticlesModule],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
