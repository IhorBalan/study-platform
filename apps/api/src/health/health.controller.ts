import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@study/shared';
import { sql } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.module.js';

@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Get()
  async check(): Promise<HealthResponse> {
    let database: HealthResponse['database'] = 'up';
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      version: process.env.npm_package_version ?? '0.0.0',
    };
  }
}
