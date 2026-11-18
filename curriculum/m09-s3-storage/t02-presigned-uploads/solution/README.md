# Presigned uploads

```sh
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test UPLOADS_BUCKET=dev-uploads
npm run create-bucket && npm run build && npm start
```

## What the signature does and does not protect

The upload URL's signature covers the method, the bucket and key, the expiry, and the `content-type` and `content-length` headers. Real S3 rejects a PUT that changes any of them. It says nothing about what the bytes are: a PNG-typed upload of an HTML file passes. That is why `complete` reads the object's HEAD and first bytes, and deletes anything that does not match. The emulator does not check signatures at all, so here `complete` is the only line of defence; in production it is the second.

## Missing before production

- **Malware scanning.** PDFs can carry exploits. Run a scan (GuardDuty Malware Protection for S3, or ClamAV in a worker fed by S3 events) and keep files `pending` until it reports clean, ideally uploading into a quarantine prefix that nothing serves.
- **Clean-up of abandoned uploads.** Keys that are issued but never completed, and objects uploaded but never confirmed, stay forever. A lifecycle rule on an `incoming/` prefix plus a job that expires `pending` rows fixes both.
- **A CORS rule on the bucket.** A browser's PUT to another origin is preflighted; without `AllowedOrigins` for the app and `AllowedMethods: PUT`, uploads fail in the browser but work in curl.
- **Image re-encoding.** Magic bytes prove the file starts like a PNG, not that the rest is harmless. Decoding and re-encoding images (and stripping EXIF location data) in a worker removes polyglot files and privacy leaks.
- **Persistence and quotas.** The `Map` disappears on restart and is per instance. A `files` table with a status column, plus a per-user storage quota, replaces it.
