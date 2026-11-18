# Inventory repository

`src/inventory.ts` reserves stock for orders with `pg`. It passes a quick manual test and is still wrong. See for yourself:

```sh
pnpm lab up postgres
createdb -h localhost -p 55432 -U lab inventory     # password: lab
export DATABASE_URL=postgres://lab:lab@localhost:55432/inventory
npm install
npm run db:reset
npm run demo          # 30 concurrent reservations against a stock of 10
```

## Notes

TODO: which approach you chose to prevent the lost update (atomic conditional UPDATE, SELECT ... FOR UPDATE, or SERIALIZABLE with retries), why, and what it costs under heavy contention on one product.
