# Payments API: idempotency keys

`POST /payments` charges the card every time it is called. A mobile client that retries after a timeout charges the customer twice. Read the task brief, then make the endpoint safe to retry.

```sh
npm install
npm run build && npm start     # http://127.0.0.1:3000
curl -i -X POST http://127.0.0.1:3000/payments \
  -H 'content-type: application/json' -H 'Idempotency-Key: 8e0f6a52-demo' \
  -d '{"amount":1999,"currency":"EUR"}'
```

Do not change `src/payments/payment-gateway.ts`.

## Notes

Write a few lines here: where your idempotency records live, how long you would keep them in production, and what changes when the API runs on more than one instance.
