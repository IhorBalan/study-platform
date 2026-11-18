import type { Pool } from 'pg';

export class OutOfStockError extends Error {
  constructor(productId: number, requested: number) {
    super(`Not enough stock for product ${productId} (requested ${requested})`);
    this.name = 'OutOfStockError';
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

export function createInventory(pool: Pool): Inventory {
  return {
    // This works when one request arrives at a time. Under load it is wrong in
    // more than one way. TODO: make it correct; see the task brief.
    async reserve(productId, quantity, orderRef) {
      const { rows } = await pool.query<{ stock: number }>('select stock from products where id = $1', [productId]);
      if (rows.length === 0) throw new Error(`Unknown product ${productId}`);
      const stock = rows[0].stock;
      if (stock < quantity) throw new OutOfStockError(productId, quantity);

      await pool.query('update products set stock = $1 where id = $2', [stock - quantity, productId]);
      const inserted = await pool.query<{ id: string }>(
        `insert into reservations (product_id, quantity, order_ref)
         values (${productId}, ${quantity}, '${orderRef}') returning id`,
      );
      return { id: Number(inserted.rows[0].id), productId, quantity, orderRef };
    },

    async stockOf(productId) {
      const { rows } = await pool.query<{ stock: number }>('select stock from products where id = $1', [productId]);
      if (rows.length === 0) throw new Error(`Unknown product ${productId}`);
      return rows[0].stock;
    },
  };
}
