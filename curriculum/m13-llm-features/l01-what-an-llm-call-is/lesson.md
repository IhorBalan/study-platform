---
title: What an LLM call is, seen from the backend
skills: [llm-api-basics]
---

From the browser, a chat feature looks like magic. From the backend, it is an HTTP call to a slow, metered, non-deterministic service. It takes seconds, it is billed per token, it can fail with a 429 or a 529, and the same input can give a different output. This lesson gives you the vocabulary and the shape of that call, so the rest of the module can treat it like any other dependency.

## The request: messages in, text out

Every current chat API takes the same basic shape:

- **Instructions** (the "system prompt"): who the model is, what it may do, what format to answer in. Your code writes these.
- **Messages**: the conversation so far, as alternating `user` and `assistant` turns. The API is stateless, so you send the whole history every time.
- **Settings**: the model id, a cap on output tokens, and optionally tools and an output schema.

The response is the assistant's next turn, a **stop reason**, and **usage** (token counts). The stop reason tells you why it stopped, and you must check it:

| Meaning | Anthropic `stop_reason` | AI SDK `finishReason` |
| --- | --- | --- |
| Finished normally | `end_turn` | `stop` |
| Hit your output cap, answer is cut off | `max_tokens` | `length` |
| Wants to call a tool | `tool_use` | `tool-calls` |
| Declined for safety reasons | `refusal` | usually `content-filter` |

A truncated answer (`max_tokens` / `length`) looks like a normal answer that stops mid-sentence. If you parse it as JSON or show it as complete, that is a bug.

## Tokens, the context window and cost

Models read and write **tokens**, chunks of text of a few characters each. A rough rule for English is four characters per token; code and other languages use more. Three things are measured in tokens:

- **The context window**: the maximum of input plus output in one call. Current Claude models accept up to a million tokens, local models often far less. Everything you send counts: instructions, history, retrieved documents, tool definitions.
- **The output cap** (`max_tokens`, `maxOutputTokens`): the most the model may write in this call. Always set it. It bounds latency and cost.
- **The bill**: providers charge per million input tokens and per million output tokens, and output costs several times more than input. Prices change often and differ per model, so read them from the provider's pricing page when you need numbers, and record the usage of every call so you can compute cost later (lesson 5).

Latency has the same shape. Time to first token is roughly constant per call, then each output token takes a few milliseconds. A 1,000-token answer takes many seconds. That is why lesson 2 streams.

## Temperature and determinism

Older APIs let you set `temperature` (randomness when picking the next token) and `top_p`. A low temperature made output more repeatable. Do not build on that: the current Claude models reject sampling parameters, and even at zero, outputs were never guaranteed to be identical. Treat model output as non-deterministic, and make the code around it deterministic: validate it, test it with a fake model (lesson 6), and store what you got.

Local models served by Ollama or LM Studio still accept `temperature`. It is useful when you experiment, but it does not change the rule.

## Two ways to call a model

**A provider SDK** speaks one provider's API exactly. With `@anthropic-ai/sdk`:

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
const message = await client.messages.create({
  model: 'claude-haiku-5-5',
  max_tokens: 512,
  system: 'You summarise support tickets in one sentence.',
  messages: [{ role: 'user', content: ticketText }],
});
if (message.stop_reason !== 'end_turn') throw new Error(`Unexpected stop: ${message.stop_reason}`);
const summary = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
console.log(summary, message.usage.input_tokens, message.usage.output_tokens);
```

You get every provider feature on the day it ships (prompt caching controls, citations, batches, the exact error classes), at the price of code that only works with that provider.

**The Vercel AI SDK** (`ai`) puts one interface over many providers. You pick a provider package, get a model object, and call `generateText`, `streamText` or `embed` with it:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

const local = createOpenAICompatible({
  name: 'ollama',
  baseURL: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
});

const result = await generateText({
  model: local.chatModel(process.env.LLM_MODEL ?? 'llama3.2'),
  instructions: 'You summarise support tickets in one sentence.',
  prompt: ticketText,
  maxOutputTokens: 512,
});
console.log(result.text, result.finishReason, result.usage.inputTokens, result.usage.outputTokens);
```

Two things in that snippet are new in AI SDK 7 and trip up older tutorials: system instructions are passed as `instructions` (it used to be `system`), and a system message inside `messages` is rejected by default. Version 7 is also ESM-only and needs Node 22 or later.

The model is a value you pass in. That is the main reason to use the AI SDK in a backend: your service takes a `LanguageModel` as a dependency, production injects a real provider, and tests inject a fake (`MockLanguageModelV4` from `ai/test`). Swapping Ollama for Claude is a change to one line of wiring, through `@ai-sdk/anthropic` or another provider package.

Pick the provider SDK when you rely on provider-specific features or when only one provider will ever matter. Pick the AI SDK when you want streaming helpers, schema-validated output, tool loops and test doubles that work the same way across providers. Many teams use both: the AI SDK for most features, the provider SDK for a batch job or an admin script.

## Practising without an API key

This module never needs a paid key. You have two options for real output:

1. **A local model.** Install [Ollama](https://docs.ollama.com/) and pull a small model (`ollama pull llama3.2`), or start the local server in LM Studio. Both serve an OpenAI-compatible API, at `http://localhost:11434/v1` and `http://localhost:1234/v1` by default. `@ai-sdk/openai-compatible` talks to either. Ollama ignores the API key, so any placeholder works.
2. **Your Claude plan.** A Claude subscription covers the Claude apps and Claude Code, not API calls from your own server. You can still use it with this module: lesson 7 connects your own MCP server to Claude Code.

All the checks use a fake model: a small HTTP server that speaks the OpenAI-compatible format, or a `MockLanguageModelV4`. Designing code so that this is possible is the real skill. The model's address comes from configuration (`LLM_BASE_URL`, `LLM_MODEL`), or the model object is a parameter.

## What the wire looks like

It helps to see that an "OpenAI-compatible" call is ordinary JSON over HTTP. This is what the AI SDK sent to a fake server for the example above:

```json
{
  "model": "llama3.2",
  "max_tokens": 512,
  "messages": [
    { "role": "system", "content": "You summarise support tickets in one sentence." },
    { "role": "user", "content": "My invoice shows the wrong VAT number." }
  ]
}
```

`POST {baseURL}/chat/completions` with that body returns `choices[0].message.content`, a `finish_reason` and `usage`. With `"stream": true` the same endpoint returns Server-Sent Events, which is where the next lesson starts.

## Treat it like any other flaky dependency

Everything from module 8 applies. Set a timeout on every call (`abortSignal: AbortSignal.timeout(30_000)` or the AI SDK's `timeout` option). The AI SDK retries 429 and 5xx responses twice by default (`maxRetries`), with exponential backoff; decide whether that suits the caller. Log the model id, the stop reason, the token counts and the latency of every call. Never log the API key, and think twice before logging prompts (lesson 5).

## Common mistakes

- Treating a `max_tokens` / `length` stop as a finished answer.
- No output cap, so one bad prompt produces a slow, expensive essay.
- Hard-coding the provider inside business logic, so nothing can be tested without a network.
- Relying on `temperature: 0` for repeatable output. Current Claude models reject it, and it was never a guarantee.
- Putting user text into the system instructions instead of a user message.
- Copying AI SDK examples written for version 4 to 6 (`system`, `maxTokens`, `onFinish`, `fullStream`) without checking the version 7 names.

## Go deeper

- [Claude API: Messages](https://platform.claude.com/docs/en/api/messages): the request and response fields, including stop reasons and usage.
- [AI SDK: Generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text): `generateText`, `streamText` and their results.
- [AI SDK: OpenAI-compatible providers](https://ai-sdk.dev/providers/openai-compatible-providers): how one provider package reaches Ollama, LM Studio and others.
- [Ollama: OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility): what the local endpoint supports.
- [Claude API: Pricing](https://platform.claude.com/docs/en/about-claude/pricing): how input, output, cache and batch tokens are priced.
