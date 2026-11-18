The help widget of a project management app waits up to ten seconds for a complete answer from a model. Make it stream: forward the model's text to the browser as it is generated, stop paying when the user leaves, and fail cleanly.

## Requirements

Keep `src/app.module.ts` exporting `AppModule`. The model is any OpenAI-compatible server, configured by environment variables that are set before the app is created:

| Variable | Meaning |
| --- | --- |
| `LLM_BASE_URL` | for example `http://localhost:11434/v1` |
| `LLM_MODEL` | the model id to request |
| `LLM_API_KEY` | optional |
| `LLM_TIMEOUT_MS` | total time allowed for one answer, default 30000 |

`POST /chat/stream` takes JSON `{ "message": "..." }`, a string of 1 to 4000 characters. Anything else gets `400` before the model is called.

A valid request gets status `200` with `content-type: text/event-stream` and these events, each with JSON data:

| Event | Data | When |
| --- | --- | --- |
| `delta` | `{ "text": "..." }` | for every piece of text, as soon as it arrives |
| `done` | `{ "finishReason": "stop", "usage": { "inputTokens": 7, "outputTokens": 3 } }` | once, at the end |
| `error` | `{ "code": "rate_limited" \| "upstream_error" \| "timeout" }` | once, instead of `done` |

The call to the model sends system instructions, the message as a user message (not inside the instructions) and an output cap of at most 1024 tokens. It is made once, without retries. A `429` from the model maps to `rate_limited`, any other failure to `upstream_error`, and the model's error text never reaches the client. When the client disconnects, the request to the model is aborted. When `LLM_TIMEOUT_MS` passes, the stream ends with `timeout` and the model request is aborted.

## Submission

The whole project without `node_modules` and `dist`, with the README question answered.

## What is checked

The checks compile the project, start a fake OpenAI-compatible server, create the app from `AppModule` and send requests that make the fake stream normally, stream slowly, return 429 or 500, or stall. They read your events as they arrive, inspect what the fake received, and disconnect mid-answer to see whether the model request is closed. The review looks at how cancellation is wired and how errors are mapped.
