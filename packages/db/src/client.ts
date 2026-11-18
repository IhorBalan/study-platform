import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
}

export interface CreateDatabaseOptions {
  /** Called when an idle pooled connection fails, e.g. because Postgres restarted. */
  onPoolError?: (error: Error) => void;
}

export function createDatabase(
  connectionString: string,
  options: CreateDatabaseOptions = {},
): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // An idle client emits 'error' when the server goes away. Without a listener
  // Node treats that as an unhandled 'error' event and exits the process. The
  // pool has already discarded the broken client and will open a new one on the
  // next query, so reporting the error is all that is needed.
  pool.on('error', (error) => {
    (options.onPoolError ?? ((e) => console.error('[db] idle connection lost:', e.message)))(error);
  });
  return { db: drizzle(pool, { schema }), pool };
}
