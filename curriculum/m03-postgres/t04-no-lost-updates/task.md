An online shop reserves stock when a customer checks out. The starter does it with `pg` in a way that works for one request at a time and breaks under load. Fix it.

## The code

`db/schema.sql` has `products (id, name, stock)` with `stock >= 0`, and `reservations (id, product_id, quantity, order_ref)` with a unique `order_ref`. `src/inventory.ts` exports:

```ts
export class OutOfStockError extends Error {}
export function createInventory(pool: Pool): Inventory;

interface Inventory {
  reserve(productId: number, quantity: number, orderRef: string): Promise<Reservation>;
  stockOf(productId: number): Promise<number>;
}
// Reservation is { id, productId, quantity, orderRef }
```

`npm run demo` fires 30 concurrent reservations of one unit at a product with 10 in stock. Run it and read the result.

## Requirements

Keep those exports and their behaviour, and make `reserve`:

- **Correct under concurrency.** However many calls run at once, the reserved quantities plus the remaining stock always equal the starting stock. A call that cannot be served rejects with `OutOfStockError`.
- **Atomic.** If any part fails (for example a duplicate `orderRef`, or a quantity the table rejects), the stock is unchanged and no reservation row exists.
- **Safe with any input.** Values reach Postgres as query parameters.
- **A good pool citizen.** Every client taken from the pool goes back, also when an error is thrown.

The module receives its `Pool` from the caller and must not create its own or read environment variables. Use only `pg`.

## Submission

The project without `node_modules` and `dist`. Fill in the notes in `README.md`.

## What is checked

The checks compile the project, create the tables in a fresh schema of the database in `DATABASE_URL`, and call `createInventory` with their own pools: single reservations, 30 concurrent calls against a stock of 10 on a pool of 10, 20 concurrent calls of mixed sizes, a duplicate `orderRef` and a negative quantity, an `orderRef` containing quotes, and a burst of failing calls on a pool of 2 connections. The review looks at how the lost update is prevented and how transactions and clients are handled.
