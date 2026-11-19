import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DB, type Database } from '../../src/database/database.module.js';
import type { E2eContext } from './context.js';

/** Registered last: it cuts every database connection the application holds. */
export function databaseOutageTests(ctx: E2eContext): void {
  describe('database outage', () => {
    it('survives its connections being cut in the middle of a transaction', async () => {
      const db = ctx.app.get<Database>(DB);
      const attempt = db.transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        // From a second connection, end every other session on this database,
        // as a database restart or `pnpm restore --force` does.
        await db.execute(
          sql`select pg_terminate_backend(pid) from pg_stat_activity
              where datname = current_database() and pid <> pg_backend_pid()`,
        );
        // The transaction's connection learns about it while no query is running.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx.execute(sql`select 1`);
      });
      await expect(attempt).rejects.toThrow(/Failed query/);

      // The process is still alive and the pool has opened fresh connections.
      const res = await ctx.http().get('/api/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    });
  });
}
