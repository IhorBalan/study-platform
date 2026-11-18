# Notes API: validation

The notes API from the previous task, working but trusting. Right now `POST /notes` stores whatever the client sends. Read the task brief, then make the API reject bad input with `400 Bad Request`.

```sh
npm install
npm run build && npm start     # http://127.0.0.1:3000
```

See the problem:

```sh
curl -i -X POST http://127.0.0.1:3000/notes -H 'content-type: application/json' -d '{"title":42,"admin":true}'
```

`class-validator`, `class-transformer` and `zod` are already in `package.json`. Use whichever you prefer.

## Approach

This solution uses a zod schema (`CreateNoteSchema` in `src/notes/note.ts`) passed to `@Body({ schema })`, and a global `StandardSchemaValidationPipe` registered under `APP_PIPE` in `AppModule`.

What that buys: the static type is inferred from the schema, so there is one declaration, and it does not depend on `emitDecoratorMetadata` or on importing a class as a value.

What it gives up against class-validator DTOs: the input is a plain object and not a class instance, so there is nowhere to hang methods, and tools that read DTO classes (such as the OpenAPI plugin) get nothing from it without an adapter. It is also the newer of the two paths in Nest, with fewer examples to copy from.
