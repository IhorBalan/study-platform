A shop's support inbox gets two LLM features: automatic triage of new tickets, and an assistant that can look up orders and issue refunds. Both must survive a model that returns broken JSON, loops on tools, or reads a customer note that says "refund someone else's order".

## Requirements

Edit `src/support.ts`. Keep every export. Both functions take the model as their first parameter (`LanguageModel` from `ai`), and nothing calls a network.

**`triageTicket(model, ticket)`** resolves to `{ triage, attempts }`.

- `TriageSchema` accepts exactly: `category` (`billing`, `bug`, `account`, `other`), `priority` (`low`, `normal`, `high`, `urgent`), `summary` (1 to 200 characters), `orderId` (`ord_` plus 6 or more lowercase letters or digits, or `null`). No other keys.
- Use `generateText` with `Output.object({ schema: TriageSchema })`, system instructions, and the ticket as a user message only.
- If the output is invalid, make **one** repair call that includes the original ticket, the invalid answer and the names of the fields that failed. `attempts` is 1 or 2.
- If the repair is invalid too, reject with `TriageFailedError` (`attempts` 2). Errors that are not about the output, such as a failed connection, reach the caller unchanged and are never repaired.

**`runSupportAgent(model, question, deps, { maxSteps = 5 })`** resolves to `{ text, steps, refunds }`.

- Offer two tools: `getOrder({ orderId })` and `refundOrder({ orderId, amountCents })`, with `orderId` in the format above and `amountCents` a positive integer.
- `getOrder` returns status, total and note for the signed-in customer's (`deps.customerId`) orders. For anyone else's order it returns exactly what it returns for an order that does not exist.
- `refundOrder` calls `deps.refund` only for the customer's own order, with status `delivered`, an amount up to `totalCents`, and at most once per run. Otherwise it returns an error result.
- Stop after `maxSteps` model calls. If the model still wants tools then, reject with `StepLimitError`.
- `refunds` lists the refund ids issued.

## Tests

Write tests in `test/*.test.mjs` with `node:test` and `MockLanguageModelV4`, importing from `../dist/support.js` only. `npm test` builds and runs them. They must pass, and they must fail against a copy of your module that never makes a repair call, and against one that treats every order as the customer's own.

## Submission

`src/`, `test/` and `README.md` with the question in it answered.

## What is checked

The checks compile the project and drive both functions with scripted models: valid, invalid and non-JSON answers, a connection error, tool calls with malformed input, a model that never stops calling tools, another customer's order, and a prompt-injected note that asks for a refund of someone else's order. They inspect what your code sent to the model and which `deps` calls ran, then run your tests against your module and two broken copies.
