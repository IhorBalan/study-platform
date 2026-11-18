Order events arrive on an SQS queue. Write the worker loop that consumes them: it must never lose a message, never run a slow message twice at once, back off on failures, let the queue dead-letter poison messages, and stop cleanly when the container is replaced.

## Requirements

Edit `src/worker.ts`. Keep its exported types. Import only `@aws-sdk/client-sqs` and Node built-ins, and call AWS only through `options.sqs.send(...)`: the checks pass in a client that records the commands.

**`startWorker(options)`** starts a loop and returns `{ stop() }`.

- **Receive:** `ReceiveMessage` on `queueUrl` with `WaitTimeSeconds` = `waitTimeSeconds` (default 20) and `MaxNumberOfMessages` = `maxMessages` (default 10). Request the `ApproximateReceiveCount` attribute.
- **Handle:** for each message call `handler({ messageId, body, receiveCount })`, where `body` is the message body parsed as JSON and `receiveCount` is a number. A body that is not JSON counts as a failure and never reaches the handler.
- **Heartbeat:** while the handler runs, every `visibilityTimeoutSeconds / 2` seconds (option, default 30), set the message's visibility to `visibilityTimeoutSeconds`.
- **Success:** delete the message.
- **Failure:** do not delete it. Set its visibility to `retryBaseSeconds * 2 ** (receiveCount - 1)` seconds (default base 5), at most `maxRetryDelaySeconds` (default 900). After the queue's `maxReceiveCount`, SQS moves it to the dead-letter queue.
- **`stop()`:** stop receiving, end a pending long poll at once (well under a second or two), wait until messages in progress are finished and deleted, then resolve. Nothing is received after that.

The checks create their own queues, with names starting with `AWS_RESOURCE_PREFIX`, and pass you the URL.

## Tests

Write tests in `test/*.test.ts` with `node:test`, against the emulator. The SDK reads `AWS_ENDPOINT_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from the environment. Start every queue name with `AWS_RESOURCE_PREFIX` and delete your queues in `after()`. Your tests must pass, and fail against a worker that treats failures as successes and one that handles every message twice.

## Submission

`src/`, `test/`, `package.json`, `tsconfig.json` and `README.md`, without `node_modules`. Answer the four notes in `README.md`.

## What is checked

The checks run `tsc`, then start your worker on fresh queues: the receive parameters, five messages handled and deleted, a handler that fails twice (on a queue with a 30-second visibility timeout, so only your retry delay brings it back in time), a poison message with `maxReceiveCount` 3, a 5-second handler on a 2-second visibility timeout with two workers, and `stop()` both idle and during a slow message. Then they run your tests against your code and two broken copies.
