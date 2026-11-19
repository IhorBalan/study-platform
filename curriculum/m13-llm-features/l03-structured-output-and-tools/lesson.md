---
title: Structured output and tool calling
skills: [llm-structured-output]
---

Most backend features do not want prose from a model. They want a category, a priority, an extracted address, or a decision to look something up. This lesson covers the two mechanisms for that: **structured output**, where the model's answer must match a schema, and **tool calling**, where the model asks your code to run a function and continues with the result. Both come down to the same rule you already apply to request bodies: the model is an untrusted client, so validate what it sends.

## Structured output with a schema

You describe the shape with zod, and the AI SDK does three things with it: it converts the schema to JSON Schema and sends it to the provider, it parses the answer as JSON, and it validates the result against the schema before you see it.

```ts
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';

export const Triage = z.strictObject({
  category: z.enum(['billing', 'bug', 'account', 'other']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  summary: z.string().min(1).max(200),
});

export async function triage(model: LanguageModel, ticket: string) {
  const { output } = await generateText({
    model,
    instructions: 'Classify the support ticket. Answer with JSON only.',
    messages: [{ role: 'user', content: ticket }],
    output: Output.object({ schema: Triage }),
    maxOutputTokens: 400,
  });
  return output; // typed as z.infer<typeof Triage>
}
```

`Output.object()` is the AI SDK 7 way. Many tutorials use `generateObject()`, which version 7 marks as deprecated, or the removed `experimental_output` option. Use `output` on `generateText`, which also combines with tools. There are also `Output.array()`, `Output.choice()` for classification into a fixed set of strings, and `Output.json()` for JSON without a schema.

How strongly the provider enforces the schema varies. Claude's API supports structured outputs (`output_config.format`) and strict tool schemas (`strict: true`) that constrain generation to valid JSON. Many local models only have a "JSON mode", which promises JSON but not your fields. That is why the SDK validates on your side regardless, and why your code must expect a failure.

### When the output is invalid

If the answer is not valid JSON, or does not match the schema, `generateText` rejects with `NoObjectGeneratedError`. The error carries the raw `text`, the `cause` (the parse or validation error) and the `usage` you were billed for.

A useful pattern is **one repair attempt**: send the model its own invalid answer and the validation errors, and ask again.

```ts
import { NoObjectGeneratedError } from 'ai';

try {
  return await callOnce(messages);
} catch (error) {
  if (!NoObjectGeneratedError.isInstance(error)) throw error; // network or API errors are not repairable
  const issues = describeIssues(error.text); // for example "- priority: Invalid option"
  return await callOnce([
    ...messages,
    { role: 'assistant', content: error.text ?? '' },
    { role: 'user', content: `Your answer was invalid:\n${issues}\nReply with corrected JSON only.` },
  ]);
}
```

Three details matter. Repair only output errors, not transport errors: a timeout is not fixed by explaining the schema again. Name the fields that failed, because "invalid JSON" alone gives the model little to work with. And stop after one repair. If the second answer is also invalid, the input or the prompt is the problem, and a loop only burns tokens. Throw a domain error and let the caller decide, for example by putting the ticket in a "needs a human" queue.

### Designing schemas for models

- **Use enums for anything your code branches on.** `z.enum([...])` is far more reliable than "a short category name".
- **Make "unknown" representable.** If an order id may be missing, use `.nullable()`. A required field that the input cannot fill invites the model to invent a value.
- **Reject unknown keys** with `z.strictObject()`, so a model that adds `"sentiment": "angry"` does not slip extra data into your system.
- **Keep it flat and small.** Deeply nested optional structures fail more often, especially on small local models.
- **Constraints are part of the contract.** `max(200)` on a summary is checked by zod even when the provider ignores it.

## Tool calling

A tool is a function the model may ask you to call. You give it a name, a description, an input schema and an `execute` function:

```ts
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';

const getOrder = tool({
  description: "Look up one of the signed-in customer's orders by id.",
  inputSchema: z.object({ orderId: z.string().regex(/^ord_[a-z0-9]{6,}$/) }),
  execute: async ({ orderId }) => {
    const order = await orders.findForCustomer(customerId, orderId);
    return order ? { status: order.status, totalCents: order.totalCents } : { error: 'order_not_found' };
  },
});

const result = await generateText({
  model,
  instructions: 'You are the support assistant of an online shop.',
  messages: [{ role: 'user', content: question }],
  tools: { getOrder },
  stopWhen: isStepCount(5),
});
console.log(result.text, result.steps.length, result.finishReason);
```

The model never runs anything. It returns a **tool call**: a tool name and JSON arguments, with finish reason `tool-calls`. The loop then goes like this:

1. The SDK validates the arguments against `inputSchema`.
2. If they are valid, it runs `execute` and appends a tool-result message. If they are not, it appends an error result instead and never calls your function.
3. It calls the model again with the whole conversation, including the tool call and its result. That is the next **step**.
4. This repeats until the model answers with text, or the stop condition is met.

Each step is a full model call, billed for the entire conversation so far. A five-step loop costs at least five times a single call, and every step adds latency.

### Step caps

`stopWhen` decides when the loop ends. Without it, `generateText` does a single step: you get the tool call back, but nothing continues. `isStepCount(n)` allows up to `n` model calls. (In AI SDK 6 this helper was called `stepCountIs`.)

The cap protects you from a model that keeps calling tools forever, which small models do more often than you would expect. When the cap is hit, the last step's `finishReason` is still `tool-calls`, and `result.text` is usually empty. Check for that and treat it as a failure, for example with a `StepLimitError`, instead of returning an empty answer as if it were fine.

Note also that `result.usage` in AI SDK 7 is the total over all steps, and `result.finalStep` holds the last step on its own.

### Tools are an API you expose to an untrusted caller

Treat each tool like a public endpoint, because in effect it is one: anyone who can put text in front of the model can influence which tools run and with what arguments.

- **Validate inputs** with tight schemas. A regex on the order id, `int().positive()` on an amount.
- **Authorise in code, not in the prompt.** "Only refund the customer's own orders" in the instructions is a wish. `if (order.customerId !== customerId) return { error: ... }` inside `execute` is a rule. The customer id comes from the session, never from the model's arguments.
- **Give errors back as results.** Returning `{ error: 'refund_not_allowed' }` lets the model explain the refusal. Throwing ends the loop.
- **Limit side effects.** At most one refund per conversation, amounts within the order total, and a human approval step for anything irreversible. The AI SDK's `toolApproval` option can pause a call until a person approves it. A model can ask for several tool calls in one step, and they run at the same time. So check the limit and record the use in one go, before the first `await`; a check that waits for the database first lets two calls through.
- **Return only what the model needs.** Do not hand it a whole database row with other customers' data or internal flags.

Lesson 7 explains why this matters so much: text inside a tool result, such as a customer's note on an order, can contain instructions that the model may follow.

## Testing it without a model

All of this is testable offline because the model is a parameter. `MockLanguageModelV4` from `ai/test` plays back scripted responses and records every prompt it received:

```ts
import { MockLanguageModelV4 } from 'ai/test';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const model = new MockLanguageModelV4({
  doGenerate: [
    {
      content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'getOrder', input: '{"orderId":"ord_abc123"}' }],
      finishReason: { unified: 'tool-calls', raw: undefined },
      usage,
      warnings: [],
    },
    { content: [{ type: 'text', text: 'It was delivered.' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] },
  ],
});
// ...run your function with `model`, then inspect model.doGenerateCalls[1].prompt
```

Lesson 6 builds on this for evaluation and regression tests.

## Common mistakes

- Parsing model output with `JSON.parse` and trusting it without a schema.
- Retrying invalid output in a loop with no limit.
- Repairing on network errors, which hides outages behind extra calls.
- Required fields the input cannot fill, so the model invents values.
- No `stopWhen`, then wondering why the tool ran but no answer came back; or no cap, and a runaway loop.
- Putting authorisation rules in the instructions instead of in `execute`.
- Tools that return far more data than the model needs.

## Go deeper

- [AI SDK: Generating structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data): `Output.object`, arrays, choices and error handling.
- [AI SDK: Tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling): the loop, `stopWhen`, approvals and repair.
- [Claude API: Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs): schema-constrained output and strict tools on Claude.
- [Claude API: Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview): how Claude decides to call tools and how results are sent back.
- [zod: Defining schemas](https://zod.dev/api): strict objects, enums and refinements.
