import { Module } from '@nestjs/common';
import { ArticlesModule } from './articles/articles.module.js';

@Module({
  imports: [ArticlesModule],
  // TODO: register an exception filter (APP_FILTER) that turns errors into
  // application/problem+json responses.
})
export class AppModule {}
