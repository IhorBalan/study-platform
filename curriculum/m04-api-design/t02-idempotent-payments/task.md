`POST /payments` charges the card every time it runs. A phone on a bad connection sends the request, the response is lost, and the app retries: the customer pays twice. Make the endpoint safe to retry with an `Idempotency-Key` header.

## Requirements

Keep `src/app.module.ts` exporting `AppModule`, keep the body validation and `GET /payments`, and do not change `src/payments/payment-gateway.ts`. Every call to its `charge()` is a real charge, and it takes about 150 ms. State stays in memory, and each app created from `AppModule` starts empty.

Every `POST /payments` must carry an `Idempotency-Key` header of 1 to 255 characters. The client generates it, usually a UUID, once per payment attempt.

| Situation | Response |
| --- | --- |
| Header missing, empty or longer than 255 characters | `400`, nothing charged |
| Body fails validation | `400` (as today). The key stays unused |
| New key | Charge, `201` and the payment, as today |
| Key seen before, same body, first request finished | `201` with exactly the original body and the header `Idempotent-Replayed: true`. No charge |
| Key seen before, same body, first request still running | `409`, no charge |
| Key seen before, different body | `422`, no charge |

"Same body" means the same validated request: `{"amount":1,"currency":"EUR"}` and `{"currency":"EUR","amount":1}` are the same. Only a successful `201` is stored. A request that ends in an error does not use up its key, so the client can fix it and retry with the same key.

The `400`, `409` and `422` responses are problem documents (`application/problem+json`). The starter's exception filter already produces them when you throw Nest's HTTP exceptions.

## Submission

The whole project without `node_modules` and `dist`. In `README.md`, say how long you would keep the records in production and what would have to change to run the API on several instances.

## What is checked

The checks compile the project, create a fresh app from `AppModule` for each criterion, and send payments with new keys, retries, retries with changed bodies, three simultaneous requests with one key, and an invalid body followed by a valid one under the same key. They count charges through `GET /payments`. The review looks at how the key's states are modelled and whether reserving a key is atomic.
