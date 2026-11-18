import { Controller, Get } from '@nestjs/common';

/**
 * Stands in for a bug: a route that fails in a way nobody planned for.
 * The checks call it to see what your API tells the client. Do not change this file.
 */
@Controller('debug')
export class DebugController {
  @Get('boom')
  boom(): never {
    throw new Error('connect ECONNREFUSED db.internal:5432 password=hunter2-do-not-leak');
  }
}
