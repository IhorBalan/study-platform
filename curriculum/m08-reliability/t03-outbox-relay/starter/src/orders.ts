import type { Pool } from 'pg';

export interface PlaceOrder {
  customerId: string;
  totalCents: number;
}

/** Writes the order and its order.placed message. */
export async function placeOrder(pool: Pool, input: PlaceOrder): Promise<{ orderId: number }> {
  // TODO: these are two separate writes. A crash, or a failure of the second, leaves them disagreeing.
  const { rows } = await pool.query<{ id: number }>(
    'insert into orders (customer_id, total_cents) values ($1, $2) returning id',
    [input.customerId, input.totalCents],
  );
  const orderId = rows[0].id;
  await pool.query('insert into outbox (topic, payload) values ($1, $2)', [
    'order.placed',
    JSON.stringify({ orderId, customerId: input.customerId, totalCents: input.totalCents }),
  ]);
  return { orderId };
}
