# Config loader

Configuration from SSM Parameter Store and Secrets Manager, validated before the app starts. Read the task brief, then implement `src/config.ts`.

```sh
pnpm lab up aws                        # from the platform repo, if it is not running
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_RESOURCE_PREFIX=dev-
npm install
npm test                               # writes and deletes its own parameters and secrets
npm run typecheck
```

Node strips the TypeScript types when it runs a `.ts` file, so use only erasable syntax and import local files with their `.ts` extension.

## Notes

TODO: how `loadConfig` is wired into a NestJS app so the app cannot start with bad configuration (a short code sketch).

TODO: what the app does when the database rejects its password after a rotation, using the credentials cache.

TODO: the IAM permissions this loader needs in production, with resources.

TODO: why you would, or would not, use ECS's `secrets` injection into environment variables instead.
