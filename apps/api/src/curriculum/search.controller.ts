import { Controller, Get, Query } from '@nestjs/common';
import { SearchQuery, type SearchResponse } from '@study/shared';
import { SearchService } from './search.service.js';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query({ schema: SearchQuery }) query: SearchQuery): SearchResponse {
    return this.searchService.search(query.q);
  }
}
