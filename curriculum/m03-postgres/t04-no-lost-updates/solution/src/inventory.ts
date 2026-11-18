import type { Pool, PoolClient } from 'pg';

export class OutOfStockError extends Error {
  constructor(productId: number, requested: number) {
    super(`Not enough stock for product ${productId} (requested ${requested})`);
    this.name = 'OutOfStockError';
  }
}

export class UnknownProductError extends Error {
  constructor(productId: number) {
    super(`Unknown product ${productId}`);
    this.name = 'UnknownProductError';
  }
}

export interface Reservation {
  id: number;
  productId: number;
  quantity: number;
  orderRef: string;
}

export interface Inventory {
  /** Takes `quantity` units of a product out of stock and records a reservation for `orderRef`. */
  reserve(productId: number, quantity: number, orderRef: string): Promise<Reservation>;
  /** Current stock of a product. */
  stockOf(productId: number): Promise<number>;
}

/** Runs `work` in a transaction on one pooled client, and always gives the client back. */
async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function createInventory(pool: Pool): Inventory {
  return {
    reserve(productId, quantity, orderRef) {
      return inTransaction(pool, async (client) => {
        // One atomic statement: the row lock taken by UPDATE makes concurrent
        // reservations queue up, and each one re-checks `stock >= $2` against the
        // committed value. No read-then-write gap, so no lost update.
        const updated = await client.query(
          'update products set stock = stock - $2 where id = $1 and stock >= $2 returning stock',
          [productId, quantity],
        );
        if (updated.rowCount === 0) {
          const exists = await client.query('select 1 from products where id = $1', [productId]);
          throw exists.rowCount === 0 ? new UnknownProductError(productId) : new OutOfStockError(productId, quantity);
        }
        // Same transaction: if this insert fails (a duplicate order_ref), the
        // stock change above is rolled back with it.
        const inserted = await client.query<{ id: string }>(
          'insert into reservations (product_id, quantity, order_ref) values ($1, $2, $3) returning id',
          [productId, quantity, orderRef],
        );
        return { id: Number(inserted.rows[0].id), productId, quantity, orderRef };
      });
    },

    async stockOf(productId) {
      const { rows } = await pool.query<{ stock: number }>('select stock from products where id = $1', [productId]);
      if (rows.length === 0) throw new UnknownProductError(productId);
      return rows[0].stock;
    },
  };
}
