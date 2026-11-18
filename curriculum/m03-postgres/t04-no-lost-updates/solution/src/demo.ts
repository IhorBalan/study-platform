// Fires 30 concurrent reservations at a product with 10 in stock.
// Run with: npm run db:reset && npm run demo
import pg from 'pg';
import { createInventory, OutOfStockError } from './inventory.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
await pool.query('truncate reservations, products restart identity cascade');
await pool.query(`insert into products (id, name, stock) values (1, 'Lamp', 10)`);

const inventory = createInventory(pool);
const results = await Promise.allSettled(
  Array.from({ length: 30 }, (_, i) => inventory.reserve(1, 1, `order-${i}`)),
);
const ok = results.filter((r) => r.status === 'fulfilled').length;
const outOfStock = results.filter((r) => r.status === 'rejected' && r.reason instanceof OutOfStockError).length;
console.log({ reserved: ok, outOfStock, stockLeft: await inventory.stockOf(1) });
await pool.end();
