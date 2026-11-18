# Chat answers over SSE

A NestJS app with one route, `POST /chat/stream`, that should stream a model's answer to the browser. Read the task brief first.

## Run it against a local model

With [Ollama](https://docs.ollama.com/) running and a small model pulled (`ollama pull llama3.2`):

```sh
npm install
export LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=llama3.2
npm run build && npm start     # http://127.0.0.1:3000
curl -N -X POST http://127.0.0.1:3000/chat/stream \
  -H 'content-type: application/json' -d '{"message":"What is a sprint in Scrum?"}'
```

LM Studio works the same way with `LLM_BASE_URL=http://localhost:1234/v1`. Press Ctrl+C during an answer to see what happens when a client leaves.

No local model? The checks bring their own fake one, so you can also work from the brief alone.

## Your notes

Replace this section with two or three sentences: why does this endpoint not retry a failed model call, and where in a product would retries belong instead?
