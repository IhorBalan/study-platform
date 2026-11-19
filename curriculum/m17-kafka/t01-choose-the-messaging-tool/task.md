Choose a messaging tool for three workloads at one company and defend each choice. Write 400 to 800 words. Use headings, lists or a table; no code is needed.

## The company

**Stockroom** is inventory software for independent shops. The team is five engineers. The backend is one NestJS app on AWS with PostgreSQL, and it already runs Valkey for caching. Nobody on the team has run Kafka in production.

## The three workloads

1. **Label printing.** When a shop receives a delivery, the app must render a PDF of shelf labels (2 to 20 seconds of CPU each) and email it. About 3,000 jobs a day, with peaks of 200 a minute on Monday mornings. A failed render should be retried a few times with a delay. Shops on the paid plan should go ahead of free ones.
2. **Stock changes.** Every sale, delivery and manual correction changes a stock level. About 40 events per second at peak today, growing. Four consumers need these changes: the low-stock alert service, the search index, a nightly-to-hourly analytics export, and, next quarter, a new forecasting service that must start from the last three months of history. Changes to the same product must be applied in order.
3. **Supplier webhooks.** Stockroom calls each shop's suppliers' HTTP endpoints when a reorder is placed. About 500 a day. Endpoints are often slow or down for hours. Each call must eventually succeed or be reported to the shop, and a reorder must never be sent twice to the same supplier.

## What to cover

1. For each workload, **pick one** of: a Postgres table used as a queue, BullMQ, SQS (with SNS if you need it), or Kafka (self-hosted or managed). Name the deciding property of the workload.
2. For each choice, name **one alternative you rejected** and the concrete reason.
3. For workload 2, state the **key**, how the forecasting service gets **three months of history**, and what the team must operate or pay for that it does not today.
4. For workload 3, explain how you make sure a supplier **never receives the same reorder twice**, even when your worker retries after a timeout. Say also what you do with a supplier whose endpoint gives you no way to make a second attempt safe.
5. Say what would have to change about the company or its traffic for you to choose **differently for workload 2**.

## What is assessed

Whether each choice follows from a named property of the workload, whether ordering, replay and duplicates are handled where they matter, and whether you weigh operational cost honestly for a five-person team. There are no automated checks.
