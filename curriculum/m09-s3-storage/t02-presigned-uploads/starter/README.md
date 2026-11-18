# Presigned uploads

Read the task brief, then implement `src/uploads/`.

```sh
pnpm lab up aws                          # from the platform repo
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export UPLOADS_BUCKET=dev-uploads
npm install
npm run create-bucket
npm run build && npm start
```

Try the flow by hand:

```sh
curl -s -X POST localhost:3000/uploads -H 'x-user-id: alice' -H 'content-type: application/json' \
  -d '{"contentType":"image/png","size":67}'
curl -X PUT "<uploadUrl>" -H 'content-type: image/png' --data-binary @some.png
curl -s -X POST localhost:3000/uploads/complete -H 'x-user-id: alice' -H 'content-type: application/json' -d '{"key":"<key>"}'
```

## Notes

TODO: what this flow still lacks before production, and why each item matters.
