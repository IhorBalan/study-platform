import type { Pool } from 'pg';
import { tx } from './db.js';

export interface PlaceOrder {
  customerId: string;
  totalCents: number;
}

/** Writes the order and its order.placed message in one transaction: both commit, or neither does. */
export async function placeOrder(pool: Pool, input: PlaceOrder): Promise<{ orderId: number }> {
  return tx(pool, async (client) => {
    const { rows } = await client.query<{ id: number }>(
      'insert into orders (customer_id, total_cents) values ($1, $2) returning id',
      [input.customerId, input.totalCents],
    );
    const orderId = rows[0].id;
    await client.query('insert into outbox (topic, payload) values ($1, $2)', [
      'order.placed',
      JSON.stringify({ orderId, customerId: input.customerId, totalCents: input.totalCents }),
    ]);
    return { orderId };
  });
}
