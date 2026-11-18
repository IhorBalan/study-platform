import type { Pool, PoolClient } from 'pg';
import type { Message } from './messages.js';

/** Processes a message at most once per id, running apply() with the client of the transaction. */
export async function consume(
  pool: Pool,
  message: Message,
  apply: (client: PoolClient) => Promise<void>,
): Promise<'processed' | 'duplicate'> {
  // TODO: duplicates are processed again, and apply() runs outside any transaction.
  void message;
  const client = await pool.connect();
  try {
    await apply(client);
    return 'processed';
  } finally {
    client.release();
  }
}
