# Support assistant: triage and tools

Two functions for a shop's support inbox, both taking the model as a parameter. Read the task brief first.

```sh
npm install
npm test          # builds, then runs test/*.test.mjs with a scripted model
```

To try them on a real local model, create one with `@ai-sdk/openai-compatible` (for example Ollama at `http://localhost:11434/v1`) and pass it in from a small script. Small local models often break the schema or loop on tools, which is a good way to see your repair and step cap at work.

## Your notes

Replace this section with a short answer: one ticket text that tries to manipulate the triage (for example into `urgent`), and what in your code limits the damage if the model falls for it.
