# Inventory repository

## Notes

The starter read the stock, decided in JavaScript, and wrote back an absolute value. Thirty requests read `10` at the same time, each wrote `9`, and all thirty succeeded: a lost update.

I used one conditional statement: `update products set stock = stock - $2 where id = $1 and stock >= $2`. The UPDATE takes a row lock, so concurrent reservations of one product wait for each other. Under Read Committed, a waiting UPDATE re-evaluates its WHERE clause against the newly committed row, so the stock check and the decrement are atomic. Zero rows updated means out of stock (or no such product, which a second query tells apart).

The insert into `reservations` is in the same transaction, on the same client. If it fails (a duplicate `order_ref`, a negative quantity) the stock change rolls back with it.

`SELECT ... FOR UPDATE` followed by the update would also be correct, at the cost of one more round trip while holding the lock. SERIALIZABLE would work too, but every conflict becomes a 40001 error that the caller must retry.

Cost: reservations of one hot product are serialised on its row lock. Each transaction is short (two statements), so that is fine up to hundreds per second. Beyond that I would shard the stock into several rows or move counting into a queue.

Every client from `pool.connect()` is released in `finally`, so an error cannot leak a connection and exhaust the pool.
