# Multipart upload

Read the task brief, then implement `src/multipart.ts` and `src/housekeeping.ts`.

```sh
pnpm lab up aws                          # from the platform repo
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
npm install
npm run demo                             # uploads 40 MiB of random data to dev-large-files
npm run typecheck
```

## Notes

TODO: when you would use `@aws-sdk/lib-storage`'s `Upload` instead.

TODO: one more thing a lifecycle rule should do for this bucket in production, and why.
