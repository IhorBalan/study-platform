import type { Pool } from 'pg';
import type { Message, Publish } from './messages.js';

export interface RelayOptions {
  batchSize?: number;
}

/** Publishes up to batchSize pending messages, oldest first, and returns how many were published. */
export async function relayOnce(pool: Pool, publish: Publish, options: RelayOptions = {}): Promise<number> {
  const batchSize = options.batchSize ?? 50;
  // TODO: works with one relay and a publish() that never fails. Fix it for two relays and for failures.
  const { rows } = await pool.query<{ id: string; topic: string; payload: unknown }>(
    'select id::text as id, topic, payload from outbox order by outbox.id limit $1',
    [batchSize],
  );
  for (const row of rows) {
    const message: Message = { id: row.id, topic: row.topic, payload: row.payload };
    await publish(message);
    await pool.query('delete from outbox where id = $1', [row.id]);
  }
  return rows.length;
}
