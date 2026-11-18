A release went wrong halfway through its migration. Write the plan you would follow as the engineer on call, then redesign the release so this cannot happen again. Write 500 to 900 words. Numbered steps are welcome; SQL is welcome where it makes a step precise.

## The system

`shop-api` runs as 6 replicas behind a load balancer. The `orders` table has 40 million rows and takes about 30 inserts a second at this time of day. The pipeline on `main` has three stages:

1. `migrate`: runs `pnpm db:migrate || echo "migration failed, continuing"`. The migration tool runs each statement in its own transaction and records a migration as applied only when all its statements succeed.
2. `canary`: replaces 2 of the 6 replicas with the new version, then waits 15 minutes and pauses itself if the error rate is above 2 %.
3. `rollout`: replaces the remaining replicas.

## The release

Release v58 renames a column and adds an index. Migration `0042` contains:

```sql
alter table orders rename column total to total_amount;
create index orders_customer_id_idx on orders (customer_id);
```

The v58 code reads and writes `total_amount`. The v57 code reads and writes `total`.

## Timeline

- **14:02** `migrate` starts. The rename commits at once. The index build starts.
- **14:02 to 14:05** Inserts into `orders` wait behind the index build. Checkout requests time out after 10 seconds; the mobile app retries a checkout once after a timeout.
- **14:05** The pipeline's 3-minute step timeout cancels the migrate step. The index build is rolled back. The script prints `migration failed, continuing` and exits 0.
- **14:06** `canary` starts 2 replicas of v58. They pass their readiness probe, which does not touch the database.
- **14:09** You are paged. The error rate is 65 %. Logs from the v57 replicas show `column "total" does not exist`. The v58 replicas serve normally. The canary has paused itself.

## What to cover

1. **Diagnosis.** What is failing, on which version, and why.
2. **The next 15 minutes.** Compare at least two ways out, choose one and list the steps in order with the reason for each. Say what happens if someone simply rolls back the image to v57.
3. **The leftovers.** What state is the database and the migration history in, what must be done about the index, and what about the checkouts between 14:02 and 14:05?
4. **A safer release.** Rewrite the change as a sequence of deploys, each safe on its own, and show how the index gets built without blocking writes.
5. **Guardrails.** Which changes to the pipeline would have caught this earlier or limited the damage?

## What is assessed

Whether your diagnosis is right, whether your first steps would stop the errors quickly without losing data, whether the new release sequence is safe at every step, and whether your guardrails address the actual failures in this timeline. There are no automated checks.
