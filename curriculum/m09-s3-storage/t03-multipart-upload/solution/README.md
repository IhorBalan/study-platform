# Multipart upload

```sh
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
npm run demo
```

Memory stays at about `partSize × (concurrency + 1)`: 40 MiB with the defaults, whether the file is 50 MB or 5 GB. Reading the whole file first would need the whole file in RAM, and a 5 GB export would kill a container with a 1 GB limit.

## Notes

**lib-storage instead.** In application code I would use `Upload` from `@aws-sdk/lib-storage`: it does the same regrouping, concurrency (`queueSize`) and abort on failure (`leavePartsOnError: false`), uses a single PutObject for small bodies, reports progress through `httpUploadProgress` events, and is maintained by AWS. Writing it by hand is worth it when the parts come from somewhere else, for example a browser that uploads each part to its own presigned URL while the server only creates and completes the upload.

**More lifecycle rules.** If the bucket has versioning on (it should, for user files), add `NoncurrentVersionExpiration` of, say, 30 days. Without it every overwrite and every delete keeps the old version, and you pay for it forever while no listing shows it. For exports that are rarely downloaded after the first week, a transition to Standard-IA after 30 days roughly halves the storage price, at the cost of a per-GB retrieval fee.
