A teammate has shared the design document below and asked for your review before the team starts building next week. Review it as you would at work. The company, **Pantry Pilot**, sells inventory and supplier ordering software to restaurants. It has four backend engineers, a NestJS app on PostgreSQL 18 with one read replica, Valkey and SQS.

## What to write

A review of 700 to 1,200 words:

1. **Verdict** in one or two sentences: approve, approve with changes, or rework before building.
2. **Findings.** At least seven problems. For each: a severity label (blocking, should, nit), what is wrong, a concrete scenario showing the impact on restaurants or suppliers, and a specific fix. A table or one short block per finding both work.
3. **The three that matter most,** in order, and why.
4. **Questions for the author** that the document does not answer (at least two).
5. **What is good** about the document, briefly.

Judge the design against its own goals and the team's size. Do not rewrite it from scratch.

## The design document

```markdown
# Supplier orders v2 (design)

Author: Sam. Status: in review.

## Context
Restaurants on Pantry Pilot build purchase orders for their suppliers. Today the
"Send order" button calls the supplier's ordering API from the browser through
our proxy. Kitchens say it is slow and sometimes nothing arrives. v2 moves
ordering to the backend.

## Goals
- Sending an order takes under one second for the kitchen.
- An order is never lost and never sent twice to a supplier.
- Suppliers receive a PDF copy of each order by email.
- Restaurants see the order status: sent, confirmed, delivered.

## Numbers
900 restaurants, about 6,000 orders a day, most between 21:00 and 23:00 after
service. Peak is about 2 orders per second. Each order has about 20 lines.

## Architecture
We split the backend into four services, each a NestJS app in its own
container: orders-service, supplier-gateway, pdf-service and
notification-service. They share the existing Postgres database, so each service
can read and write the tables it needs.

## Sending an order
POST /orders/:id/send, called by the kitchen tablet:
1. orders-service loads the order and its lines from Postgres.
2. It calls pdf-service over HTTP to render the PDF (about 2 s).
3. It emails the PDF to the supplier over SMTP, using nodemailer directly.
4. It sets orders.status = 'sent' and commits.
5. It publishes `order.sent` to SQS for supplier-gateway.
6. It returns 200 to the tablet.
Tablets on kitchen Wi-Fi often time out, so the app retries POST /send
automatically, up to 3 times.

## Supplier gateway
supplier-gateway receives `order.sent` messages, deletes them from SQS and
pushes them onto an in-memory array; a loop sends them to the supplier's API.
The array has no size limit, so we never drop work. If a supplier API returns
an error, we retry the call every second until it succeeds.

## Draft orders
Kitchens edit draft orders all evening. To make editing fast, drafts live only
in Valkey (key `draft:{orderId}`) and are written to Postgres when the kitchen
presses Send. Valkey runs as a single container next to the API with default
settings.

## Supplier catalogue
Each supplier's catalogue (products and prices) is cached in Valkey under
`catalogue:{supplierId}` for 24 hours. Restaurants negotiate their own prices
with suppliers, stored in `restaurant_prices`; the cache entry is built for the
first restaurant that requests it.

## Order status page
GET /orders/:id returns the order with its lines and status, looked up by id.
To reduce load on the primary it reads from the read replica. After pressing
Send, the tablet immediately opens this page.

## Nightly auto-reorder
A cron entry on the VM that runs supplier-gateway creates draft orders at 03:00
for items below their par level. The VM is a single small instance. If it is
down, we will notice in the morning.

## Backups
The database provider's daily snapshot is enabled. We have not needed a restore
yet.

## Monitoring
Each service logs to stdout. We will add metrics later.

## Alternatives considered
None. This is the standard microservice architecture.
```

## What is assessed

How many of the real problems you find, whether each finding has a believable impact and a fix that fits a four-person team, whether you rank them sensibly, and whether the review is written so the author can act on it. There are no automated checks.
