# SQS worker

A worker loop for SQS. Read the task brief, then make `src/worker.ts` reliable.

```sh
pnpm lab up aws                        # from the platform repo, if it is not running
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_RESOURCE_PREFIX=dev-
npm install
npm test                               # node --test runs the .ts files directly
npm run typecheck
```

Node strips the TypeScript types when it runs a `.ts` file, so use only erasable syntax and import local files with their `.ts` extension.

## Notes

TODO: how the visibility timeout, the heartbeat and the retry delay work together.

TODO: what happens to a message when the process is killed with SIGKILL halfway through the handler, and why the handler must be idempotent.

TODO: how this worker runs next to a NestJS API (process, shutdown, scaling).

TODO: when Lambda's SQS trigger would be the better choice than this loop.
