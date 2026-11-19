import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
}

export interface CreateDatabaseOptions {
  /** Called when a pooled connection fails outside a query, e.g. because Postgres restarted. */
  onPoolError?: (error: Error) => void;
}

export function createDatabase(
  connectionString: string,
  options: CreateDatabaseOptions = {},
): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // A client emits 'error' when the server goes away. Without a listener Node
  // treats that as an unhandled 'error' event and exits the process. The pool
  // listens only while a client is idle; one that is checked out (inside a
  // transaction, between two statements) would still end the process. So each
  // client gets its own listener, which also covers the idle case. The broken
  // client's next query fails, the pool drops it and opens a new one.
  const report =
    options.onPoolError ?? ((e: Error) => console.error('[db] connection lost:', e.message));
  pool.on('connect', (client) => {
    client.on('error', report);
  });
  // The pool re-emits the idle case; it is already reported above.
  pool.on('error', () => undefined);
  return { db: drizzle(pool, { schema }), pool };
}
