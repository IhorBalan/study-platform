# A small stack

Uploads bucket, jobs queue with a dead-letter queue, and an SSM parameter that tells the app where the queue is.

## Run it against the emulator

```sh
pnpm lab up aws
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
tofu init
tofu plan -var environment=dev -out dev.tfplan
tofu apply dev.tfplan
tofu destroy -var environment=dev
```

## Decisions

- The DLQ keeps messages for 14 days, the source queue for 4. A message keeps its original age when it is moved, so a DLQ with the same retention would drop old messages almost at once.
- `maxReceiveCount` is a number (from a `number` variable), not the string `"5"`.
- The lifecycle rule expires noncurrent versions after 30 days and aborts unfinished multipart uploads after 7, so versioning does not grow the bill forever.
- Tags come from one local through `default_tags`, so every resource carries Project, Environment and ManagedBy without repeating them.

## Against real AWS

Remove `endpoints`, `s3_use_path_style` and the three `skip_*` arguments (or move this provider block into an emulator-only file), and let credentials come from a role, never from a key in a file. On real AWS bucket names are global, so the project prefix alone may already be taken.
