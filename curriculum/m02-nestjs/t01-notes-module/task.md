Build the first feature of a NestJS app: a notes API that keeps its data in memory.

## Requirements

The starter is an empty NestJS 12 app. Keep `src/app.module.ts` exporting a class named `AppModule`, and keep `tsconfig.json` and `package.json` as they are. Put the feature in `src/notes/`: a `NotesModule`, a controller and a service. `AppModule` imports `NotesModule`.

A note looks like this. The server generates `id` and `createdAt`.

```json
{ "id": "a-unique-string", "title": "Buy milk", "body": "Two litres", "createdAt": "2026-01-31T09:30:00.000Z" }
```

| Request | Response |
| --- | --- |
| `POST /notes` with `{ "title": "...", "body": "..." }` | `201` and the created note. `body` is optional and is stored as `""` when left out |
| `GET /notes` | `200` and a JSON array of all notes, oldest first |
| `GET /notes/:id` | `200` and the note, or `404` |
| `DELETE /notes/:id` | `204` with no body, or `404` |

A `404` has a JSON body. Nest's default one is fine. Deleting the same note twice gives `204` and then `404`. You do not need to validate the input yet; that is the next task.

The service owns the storage and knows nothing about HTTP. The controller receives the service by constructor injection and decides on status codes.

## Submission

The whole project without `node_modules` and `dist`.

## What is checked

The checks compile the project with `tsc -p tsconfig.json`, import `dist/app.module.js`, create the app from `AppModule` and call every route above over HTTP. They do not run `src/main.ts`. Each run starts with an empty store. The review then looks at module boundaries, how the dependency is injected and how thin the controller is.
