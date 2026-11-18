import type { Pool } from 'pg';
import { tx } from './db.js';
import type { Message, Publish } from './messages.js';

export interface RelayOptions {
  batchSize?: number;
}

/**
 * Publishes up to batchSize pending messages, oldest first, and returns how many were published.
 *
 * The claimed rows stay locked (FOR UPDATE) until this transaction ends, and SKIP LOCKED makes other
 * relays pass over them, so two relays never publish the same message at the same time.
 * If publish() fails, the message stays pending and the round stops, keeping the rest in order.
 * A crash after publish() and before COMMIT re-publishes the message later: delivery is at least once.
 */
export async function relayOnce(pool: Pool, publish: Publish, options: RelayOptions = {}): Promise<number> {
  const batchSize = options.batchSize ?? 50;
  return tx(pool, async (client) => {
    const { rows } = await client.query<{ id: string; topic: string; payload: unknown }>(
      `select id::text as id, topic, payload
         from outbox
        where published_at is null
        order by outbox.id
        limit $1
        for update skip locked`,
      [batchSize],
    );
    let published = 0;
    for (const row of rows) {
      const message: Message = { id: row.id, topic: row.topic, payload: row.payload };
      try {
        await publish(message);
      } catch (error) {
        await client.query('update outbox set attempts = attempts + 1, last_error = $2 where id = $1', [row.id, String(error)]);
        break;
      }
      await client.query('update outbox set published_at = now(), attempts = attempts + 1 where id = $1', [row.id]);
      published++;
    }
    return published;
  });
}
