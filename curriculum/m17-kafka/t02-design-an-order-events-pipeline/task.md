Design the Kafka side of an order-events pipeline, then walk through a crash. Write 500 to 900 words. Use headings, lists or a table; small SQL or config snippets are welcome but not required.

## The system

**Brewbox** sells coffee subscriptions. The `orders` service owns an `orders` table in PostgreSQL. Orders move through `placed`, `paid`, `packed`, `shipped` and sometimes `cancelled` or `refunded`. The company uses a managed Kafka cluster with three brokers.

Three consumers need order changes:

- **fulfilment** prints packing slips. It must never pack a cancelled order, so it must see an order's events in the order they happened.
- **notifications** sends the customer an email on `paid` and `shipped`. Customers complain loudly about duplicate emails.
- **analytics** loads every event into a warehouse. It is fine if it runs hours behind, and it was broken for two days last month.

Peak load is about 300 order events per second, and the team expects ten times that within two years.

## What to cover

1. **Getting events out of Postgres.** How does an order change become a Kafka record without the dual-write problem? Show the outbox table or describe the CDC setup.
2. **Topics.** Name the topic or topics, with partition count, replication factor, `min.insync.replicas`, producer `acks` and idempotence, retention and cleanup policy. Justify the partition count against today's load and the expected growth.
3. **Keys and ordering.** What is the record key? Explain exactly what ordering fulfilment gets and what it does not get.
4. **Consumer groups.** One group or several? How many instances can each consumer usefully run?
5. **Event shape.** List the fields of one event and how its schema may evolve.
6. **A crash mid-batch.** A fulfilment instance owns partitions 2 and 5, uses auto-commit every 5 seconds, and has processed records 1,000 to 1,040 of partition 2 when the pod is killed. The last committed offset for partition 2 was 1,012. Describe step by step what happens next: who gets the partitions, from which offset they resume, which records are processed twice, and what happens to records 1,041 onwards.
7. **Making that safe.** Which consumers need to be idempotent, and how exactly (per consumer)?
8. **Analytics was broken for two days.** How does it catch up without affecting the other consumers, and what setting would have made this impossible?

## What is assessed

Whether the design avoids the dual write, whether keys, partitions and groups give the ordering and scale required, whether your crash walk-through uses offsets correctly, and whether each consumer survives duplicates. There are no automated checks.
