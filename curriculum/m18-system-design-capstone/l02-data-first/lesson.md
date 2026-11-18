---
title: "Data first: models, consistency and access paths"
skills: [sd-data-design]
---

Code is easy to change. Data is not: a table with 50 million rows, three services reading it and five years of history behind it is the hardest thing in your system to move. That is why experienced engineers design the data before the boxes. This lesson shows how to get from a product description to a data model, decide how consistent each piece of data must be, separate read paths from write paths, denormalise on purpose, and pick a tenancy model.

Module 3 taught keys, constraints, normalisation and indexes. Here we use them as design tools.

## From access patterns to tables

Start from what the product does, not from nouns. For a helpdesk SaaS where small businesses answer customer email:

1. **List the entities:** workspace, agent, customer, ticket, message, tag.
2. **List the operations, with rough frequency:**

| Operation | Kind | Frequency |
| --- | --- | --- |
| Inbound email creates or appends to a ticket | write | 20/s at peak |
| Agent opens the ticket list: open tickets in my workspace, newest activity first | read | 200/s at peak |
| Agent opens one ticket with its messages | read | 100/s |
| Agent replies (message + status change) | write | 10/s |
| Dashboard: open ticket count per agent | read | 50/s |
| Monthly export of all tickets | read | rare, large |

3. **Design tables that make the frequent operations cheap**, then check the rare ones are still possible.

```sql
create table tickets (
  workspace_id    bigint not null references workspaces (id),
  id              uuid not null default uuidv7(),
  customer_id     uuid not null,
  assignee_id     uuid,
  status          text not null check (status in ('open', 'pending', 'closed')),
  subject         text not null,
  last_message_at timestamptz not null,
  message_count   int not null default 0,
  primary key (workspace_id, id),
  foreign key (workspace_id, customer_id) references customers (workspace_id, id)
);

-- the ticket list: one workspace, one status, newest activity first
create index tickets_list on tickets (workspace_id, status, last_message_at desc);
```

Notice what the table already says about the design: tenancy is part of every key, the list query has an index shaped exactly like it, and `last_message_at` and `message_count` are copies of data that lives in `messages`. That last choice needs a justification, which comes below.

`uuidv7()` is built into PostgreSQL 18. Its time-ordered prefix keeps inserts at the end of the index like an identity column, while the value is safe to show in URLs.

## Consistency is per operation

"Strong or eventual consistency?" is the wrong question for a whole system. Ask it per piece of data: **if a reader sees an old value, who notices, and what does it cost?**

- **Must be current:** money, stock, permissions, "has this invoice been sent". A stale read causes a double charge or a data leak. Read from the primary, inside the transaction that acts on it, often with a lock or a constraint (module 8).
- **Read your own writes:** an agent changes a ticket's status and reloads the page. Other users may see the change a second later, but the author must see it at once.
- **Eventually is fine:** counters on a dashboard, search results, analytics, an activity feed. Seconds or minutes of delay are acceptable if they converge.

With one Postgres primary, everything is strongly consistent for free. Consistency is lost the moment you add a *copy*: a cache, a read replica, a search index, a denormalised column, another service's database. So every copy in a design needs three answers: what is the source of truth, how does the copy get updated, and how stale can it be.

## Read paths and write paths

Draw them separately. The **write path** of "agent replies" is:

```ts
await db.transaction(async (tx) => {
  await tx.insert(messages).values({ workspaceId, ticketId, authorId, body });
  await tx
    .update(tickets)
    .set({
      status: 'pending',
      lastMessageAt: sql`now()`,
      messageCount: sql`${tickets.messageCount} + 1`,
    })
    .where(and(eq(tickets.workspaceId, workspaceId), eq(tickets.id, ticketId)));
  await tx.insert(outbox).values({ type: 'ticket.replied', payload: { ticketId } });
});
```

One transaction updates the source (`messages`), the copy (`tickets.last_message_at`) and records an event for side effects (module 8's outbox). The **read path** of the ticket list then touches one index and one table, with no join and no aggregate.

That is the general trade: you make writes a little more expensive so that frequent reads are cheap. It is worth it when reads outnumber writes heavily, as they usually do.

## Denormalise on purpose

Good reasons to keep a copy:

- **A frequent read would otherwise join or aggregate a large table.** `message_count` instead of `count(*)` on every list row.
- **Sorting or filtering needs a value from another table.** You cannot index `tickets` by the newest message's time unless that time is on `tickets`.
- **History must not change.** An invoice line stores the price at the time of sale, not a reference to today's price. This is not really a copy; it is a different fact.

For each copy, choose how it stays correct:

| Method | Staleness | Use when |
| --- | --- | --- |
| Same transaction as the source | none | the copy is on the hot path and cheap to update |
| Trigger | none | many code paths write the source and you cannot trust them all |
| Background job from an event | seconds | the update is expensive or touches many rows |
| Periodic rebuild or materialised view | minutes to hours | reports and dashboards |

Whatever you pick, write down how to rebuild the copy from the source. Copies drift through bugs, and a rebuild script turns a data incident into a chore.

## Hot rows

A single row updated by many concurrent transactions becomes a queue, because each update takes the row lock. A `workspaces.document_count` incremented on every upload is fine at 5 uploads a second and painful at 500. Options: count in a separate table with one row per workspace per day, append events and aggregate later, or keep the counter in Valkey and flush it. The trick is spotting the hot row in the design before it is in production.

## Tenancy is a data decision

For B2B software, the first data question is how customers' data is separated. Module 6, lesson 8 covers the security side; here is the design view.

| Model | Good at | Costs |
| --- | --- | --- |
| Shared tables, `tenant_id` on every row | One schema, one migration, cheap tenants, cross-tenant analytics | A missing filter leaks data; one big tenant affects others |
| Schema per tenant | Per-tenant backup and restore are simpler | Migrations run N times; thousands of schemas strain tooling |
| Database per tenant | Strong isolation, per-tenant region or encryption keys | Operations multiply with each tenant; cross-tenant queries are hard |

The default for a startup is **shared tables with a tenant id**, plus guard rails: the tenant id leads every primary key, foreign key and index, the repository layer always filters by it, and Row-Level Security (module 3, lesson 9) is a safety net. Keep a path open for the one enterprise customer who demands isolation: a design where tenant id is everywhere can later move one tenant to its own database with a filtered copy.

## Other data decisions to make early

- **Soft delete or hard delete.** Soft delete keeps a `deleted_at` and complicates every query and unique constraint; hard delete with an audit table is often simpler. Privacy law may require real deletion.
- **Time.** Store `timestamptz`, always UTC; convert at the edge.
- **Money.** Integer minor units and a currency code (module 10).
- **Large text and files.** Bodies of emails can be big; files go to object storage with a row that points at them.
- **Retention.** How long do messages, logs and events live? Unbounded tables become your scaling problem in year two.

## Common mistakes

- Designing tables from nouns without listing the queries and their frequencies.
- Declaring the whole system "eventually consistent" instead of deciding per operation.
- Adding a denormalised column without saying how it stays correct or how to rebuild it.
- Putting `tenant_id` on some tables but not in the keys and indexes, so a filter is easy to forget and queries are slow.
- A hot counter row on the busiest write path.

## Go deeper

- [PostgreSQL: Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html): the database enforcing your invariants.
- [PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): the safety net for shared-table tenancy.
- [PostgreSQL: UUID functions](https://www.postgresql.org/docs/current/functions-uuid.html): `uuidv7()` and its ordering.
- [PostgreSQL: Materialized views](https://www.postgresql.org/docs/current/rules-materializedviews.html): periodic copies for reports.
