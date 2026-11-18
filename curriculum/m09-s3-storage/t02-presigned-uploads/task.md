Users upload images and PDFs of up to 10 MiB. The bytes must go from the browser straight to S3, never through the API. Build the three endpoints of that flow in NestJS.

The starter has the routes, a stand-in for authentication (`x-user-id` header, 401 without it), the bucket and client providers, and the allowed types with their size limit and magic bytes in `src/uploads/file-types.ts`. The bucket name comes from `UPLOADS_BUCKET`; everything else from the `AWS_*` variables.

## Endpoints

**`POST /uploads`** with `{ "contentType": "image/png", "size": 48213 }`.

- `contentType` must be one of `image/png`, `image/jpeg`, `application/pdf`; `size` an integer from 1 to 10 MiB (10485760). Anything else is 400.
- Answer 201 with `{ key, uploadUrl, method: "PUT", headers: { "content-type": ... }, expiresAt }`.
- `key` is `users/<userId>/<random>.<png|jpg|pdf>`, new for every request.
- `uploadUrl` is a presigned `PutObject` for that key. It expires within 300 seconds, and its signature covers `content-type` and `content-length`. It must also work on real S3: no checksum of an empty body in the URL.

**`POST /uploads/complete`** with `{ "key": "..." }`, answered with 200 `{ key, size, contentType }` once the upload passes every check:

| Situation | Status |
| --- | --- |
| Key outside `users/<userId>/` | 403 |
| Key not issued to this user, or nothing uploaded yet | 404 |
| Stored size differs from the declared size, stored content type differs from the declared type, or the first bytes do not match the type | 422, and the object is deleted |

**`GET /downloads?key=...`** answers 200 `{ url, expiresAt }` with a presigned `GetObject` that expires within 60 seconds. 403 for a key outside the user's namespace, 404 unless the upload was completed successfully.

## README

List what this flow still lacks before production, and why each matters.

## What is checked

The checks create a bucket, boot your `AppModule`, read the presigned URLs' query parameters, upload with `fetch` (including wrong sizes, types and contents, which the emulator accepts), call the complete and download endpoints as two different users, and look in the bucket to see what was kept or deleted.
