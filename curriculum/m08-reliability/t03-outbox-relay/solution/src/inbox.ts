import type { Pool, PoolClient } from 'pg';
import { tx } from './db.js';
import type { Message } from './messages.js';

/**
 * Processes a message at most once per id. apply() runs in the same transaction as the inbox insert,
 * so the effect and the "processed" record commit together. A concurrent duplicate waits on the
 * primary key until the first commits, then sees the conflict and skips.
 */
export async function consume(
  pool: Pool,
  message: Message,
  apply: (client: PoolClient) => Promise<void>,
): Promise<'processed' | 'duplicate'> {
  return tx(pool, async (client) => {
    const { rowCount } = await client.query('insert into inbox (message_id) values ($1) on conflict do nothing', [message.id]);
    if (rowCount === 0) return 'duplicate';
    await apply(client);
    return 'processed';
  });
}
