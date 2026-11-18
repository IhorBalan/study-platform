---
title: "Cost, rate limits, caching and logging"
skills: [llm-production]
---

The first version of an LLM feature usually works. The second month is where the surprises are: an invoice three times the estimate, a launch day full of 429s, a support engineer who finds customer emails in the logs. This lesson covers the operational side: knowing what each request costs, staying inside provider limits, caching what you can, falling back when a provider fails, and logging without leaking.

## Cost per request

You cannot control what you do not measure. Record the usage of every call next to what it was for. The AI SDK reports usage on every result and in the `onEnd` callback, already summed over all steps of a tool loop:

```ts
const result = await generateText({ model, instructions, messages, maxOutputTokens: 600 });

await usageLog.insert({
  feature: 'ticket-summary',            // which product feature paid for this
  tenantId,                              // who to attribute it to
  model: result.finalStep.model.modelId,
  inputTokens: result.usage.inputTokens ?? 0,
  cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens ?? 0,
  outputTokens: result.usage.outputTokens ?? 0,
  finishReason: result.finishReason,
  latencyMs: Date.now() - started,
});
```

Compute money from tokens with a price table that lives in configuration, per model, because prices change and differ by model, by cached versus uncached input, and by batch versus interactive use. Then you can answer the questions that matter: cost per feature, per tenant, per successful outcome. "Cost per resolved ticket" is a better number than "cost per call", because a cheap call that needs three retries is not cheap.

The biggest levers, roughly in the order to try them:

1. **Send less.** Trim history, retrieve 4 chunks instead of 20, remove tool definitions a request does not need. Input tokens are paid on every step of every call.
2. **Write less.** Set `maxOutputTokens`, ask for short answers, and use structured output instead of prose your code then parses. Output tokens cost several times more than input tokens.
3. **Cache** (below).
4. **Use a smaller model where it is good enough.** Classification and extraction often work on a small, cheap model. Decide with an evaluation (lesson 6), not by feel.
5. **Batch what is not urgent.** Providers offer batch APIs at a large discount (Anthropic's is half price) for work that can wait minutes or hours, such as nightly summaries.

Put a **budget** on each tenant too: a monthly token allowance, and a per-minute limit enforced with the Valkey rate limiter from module 7. One customer's script calling your chat endpoint in a loop should hit your limit, not your provider's.

## Provider rate limits

Providers limit requests per minute and tokens per minute (often input and output separately), per organisation and per model. Exceeding them returns **429** with a `retry-after` header. A **529** or **503** means the provider itself is overloaded, which is a different problem from your own usage.

How to stay inside the limits:

- **Interactive requests**: fail fast with a clear "busy, try again" code (lesson 2), or fall back to another model. Do not let a backlog of retrying requests make the overload worse.
- **Background work**: put it on a queue (BullMQ from module 7) with a concurrency limit that matches your token budget, and let the worker honour `retry-after`. The AI SDK's retry logic respects the provider's retry headers.
- **Shape the traffic**: a nightly job that summarises 50,000 tickets at full speed will starve the daytime chat feature if they share a limit. Separate keys or workspaces per workload, or a batch API, solve that.

## Caching

There are two different things called caching here.

### Your own response cache

If the same input gets the same treatment, store the result. Key it by a hash of everything that affects the output: model id, instructions, messages, schema, settings and a prompt version.

```ts
import { createHash } from 'node:crypto';

const key = 'llm:' + createHash('sha256')
  .update(JSON.stringify({ model: modelId, promptVersion: 'triage-v3', instructions, ticket }))
  .digest('hex');
const cached = await valkey.get(key);
if (cached) return JSON.parse(cached);
```

This works for classification, extraction and summaries of content that does not change. It is wrong for chat, where every conversation is different, and for anything personalised unless the key includes the user. Bump the prompt version whenever you change the instructions, or old answers live on. "Semantic caches", which reuse an answer for a *similar* question found with embeddings, sound attractive but return wrong answers for questions that differ in one important word. Use them with care, if at all.

### Provider prompt caching

Providers can cache the *prefix* of a prompt: if a request starts with exactly the same tokens as a recent one, those tokens are read from cache, faster and at a fraction of the input price. With Anthropic's API you mark where the stable prefix ends:

```ts
const message = await client.messages.create({
  model: 'claude-sonnet-5-5',
  max_tokens: 1024,
  system: [
    { type: 'text', text: LONG_STABLE_INSTRUCTIONS_AND_POLICY, cache_control: { type: 'ephemeral' } },
  ],
  messages: [{ role: 'user', content: question }],
});
console.log(message.usage.cache_read_input_tokens, message.usage.cache_creation_input_tokens);
```

Writing to the cache costs a little more than normal input, and reading from it costs a small fraction, so it pays off from the second request on. The cache lives for minutes (five by default, longer for a higher write price), and prefixes shorter than a model-specific minimum are not cached at all.

It is a byte-exact prefix match, which shapes how you build prompts. Put stable content first (tools, instructions, a policy document) and variable content last (the user's question). A timestamp or a request id at the top of the system prompt silently disables caching for everything after it. Check that it works: cache read tokens should be non-zero from the second request.

## Fallbacks

When the primary model fails with 5xx, overload or rate limits, you can retry on another model or provider. With the AI SDK that is a second call with a different model value. Keep three things in mind:

- **Fallback output differs.** A different model formats, refuses and follows instructions differently. Run your evaluation set on the fallback too.
- **Fall back on availability errors, not on bad output.** A 400 means your request is wrong and will be wrong everywhere.
- **Do not double the bill silently.** Log which model actually answered, and alert when the fallback share rises.

## Logging prompts safely

Prompts and outputs are the most useful debugging data you have, and the most dangerous. They contain whatever users typed, retrieved documents, and tool results with customer data.

- **Log metadata by default**: feature, model, token counts, finish reason, latency, a prompt version and a hash of the input. That answers most questions.
- **Store full prompts deliberately**: in a separate store with access control, a short retention period and a clear purpose, such as building evaluation sets. Sample instead of keeping everything.
- **Redact before you store**, and ideally before you send: replace emails, phone numbers, card numbers and names with placeholders where the task does not need them. A summary of a ticket rarely needs the customer's real email address.
- **Never log credentials.** API keys in error messages or request dumps are a classic leak. Your logger's redaction list (pino's `redact` option) should include authorization headers.

## PII and the provider

Every prompt leaves your infrastructure. Before you send customer data to a model provider, know the answers to: Is there a data processing agreement? Does the provider train on API data (the major providers say no for API traffic by default, but read the terms)? How long does it retain prompts, and is zero data retention available for your account? Where is the data processed? Minimising what you send is the control you fully own: send the fields the task needs, not the whole customer record.

## Common mistakes

- No usage logging, so the first cost signal is the invoice.
- Prices hard-coded in application code.
- Retrying 429s immediately and in parallel, which deepens the overload.
- A timestamp at the start of the system prompt, which defeats prompt caching.
- A response cache key that omits the model or prompt version.
- Falling back to a different model without ever testing its output.
- Full prompts with customer data in the general application log.

## Go deeper

- [Claude API: Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): prefix rules, TTLs, pricing multipliers and minimum lengths.
- [Claude API: Rate limits](https://platform.claude.com/docs/en/api/rate-limits): how limits are measured and which headers report them.
- [Claude API: Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing): the discounted asynchronous API.
- [AI SDK: Caching](https://ai-sdk.dev/docs/advanced/caching): response caching patterns with the AI SDK.
- [pino: Redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md): removing secrets and personal data from logs.
