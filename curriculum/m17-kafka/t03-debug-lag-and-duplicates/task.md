Diagnose a consumer that falls behind and processes events twice. Write 400 to 800 words. Explain your reasoning; short code or config snippets are welcome.

## The incident

The `invoicing` service reads `payments.events` (12 partitions, keyed by customer ID) in the consumer group `invoicing`. It runs 4 pods. For each `PaymentSucceeded` event it calls an external PDF API (normally 300 ms, sometimes 30 s or more), stores the invoice in Postgres and emails it.

The handler, simplified:

```ts
await consumer.run({
  eachMessage: async ({ message }) => {
    const event = JSON.parse(message.value!.toString());
    const pdf = await pdfApi.render(event);            // no timeout set
    await db.insert(invoices).values({ paymentId: event.paymentId, pdf });
    await mailer.send(event.customerEmail, pdf);
  },
});
```

The consumer uses the client defaults: auto-commit every 5 seconds, `max.poll.interval.ms` of 5 minutes, session timeout 45 seconds.

Since Tuesday:

- Lag on the `invoicing` group climbs from near zero to 40,000 over a few hours. `kafka-consumer-groups.sh --describe` shows most of it on partitions 3 and 7. Partition 7's committed offset has not moved for six hours.
- The logs show the group rebalancing every few minutes.
- About 2% of customers received the same invoice email two or three times, and the `invoices` table has duplicate rows for some payments.
- On Tuesday the PDF provider started having slow periods, and a large customer started importing historical payments in bulk.
- Someone suggested scaling to 20 pods.

## What to cover

1. **Partition 7.** Give the most likely reason its offset has not moved for six hours, and how you would confirm it from logs or by reading the record at the committed offset.
2. **Partition 3.** Give the most likely reason for its lag, using the facts above.
3. **The rebalances.** Explain how slow PDF calls can trigger rebalances, and why rebalances make lag and duplicates worse.
4. **The duplicates.** Explain step by step how one payment can produce two invoice rows and two emails under these settings.
5. **Scaling to 20 pods.** Would it help? Say exactly what happens.
6. **Fixes.** Propose concrete changes, at least one for each cause above, and say which one stops duplicate emails even if every other fix fails.
7. **Monitoring.** Which signal would have warned you on Tuesday, and what threshold would you alert on?

## What is assessed

Whether each symptom is tied to a specific cause, whether the duplicate sequence is correct in terms of offsets and commits, and whether the fixes address causes rather than symptoms. There are no automated checks.
