# Receipt worker

Receipt emails as BullMQ jobs. Read the task brief, then make `src/receipts.ts` reliable.

```sh
pnpm lab up valkey                     # from the platform repo, if it is not running
export VALKEY_URL=redis://localhost:56379
export VALKEY_KEY_PREFIX=dev:
npm install
npm test                               # node --test runs the .ts files directly
npm run typecheck
```

Node strips the TypeScript types when it runs a `.ts` file, so use only erasable syntax and import local files with their `.ts` extension.

## Notes

TODO: how the handler makes sure one order gets one email, and the window that is left.

TODO: how long you keep completed and failed jobs, and why.

TODO: how this runs inside a NestJS app, and how it shuts down.

TODO: when would this job be better on a hosted job service (Inngest, Trigger.dev) or on Temporal?
