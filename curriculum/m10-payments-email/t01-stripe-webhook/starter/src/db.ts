import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';

export const PG_POOL = Symbol('PG_POOL');

/** Runs fn inside BEGIN ... COMMIT on one client, rolls back on error and always releases the client. */
export async function tx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
        return new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
      },
    },
    PoolCloser,
  ],
  exports: [PG_POOL],
})
export class DbModule {}
