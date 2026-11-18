# Config loader

Configuration from SSM Parameter Store and Secrets Manager, validated before the app starts.

```sh
pnpm lab up aws
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_RESOURCE_PREFIX=dev-
npm install
npm test
npm run typecheck
```

## Notes

**NestJS wiring.** An async factory provider, so `NestFactory.create` awaits it and fails before `listen`:

```ts
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [{
    provide: APP_CONFIG,
    useFactory: () => loadConfig({
      ssm: new SSMClient({}),
      secrets: new SecretsManagerClient({}),
      parameterPath: `/${process.env.APP_ENV}/orders-api/`,
      secretId: `${process.env.APP_ENV}/orders-api/db`,
    }),
  }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
```

Services inject `@Inject(APP_CONFIG) config: AppConfig`. Only `APP_ENV` (and the AWS variables the platform sets) come from the environment. A ConfigError ends the process with a list of names; ECS keeps the previous tasks because the new ones never pass the health check.

**After a rotation.** The database pool gets its password from `createCredentialsCache`. When a connection fails with Postgres error `28P01` (invalid password), the pool calls `cache.refresh()` once, rebuilds itself with the new credentials and retries; a second failure is a real error. With the alternating-users rotation strategy this rarely happens, because the old credentials stay valid until the next rotation.

**IAM.** `ssm:GetParametersByPath` on `arn:aws:ssm:<region>:<account>:parameter/prod/orders-api` and `.../parameter/prod/orders-api/*`; `kms:Decrypt` on the key that encrypts the SecureStrings (with a `kms:ViaService` condition for `ssm.<region>.amazonaws.com`); `secretsmanager:GetSecretValue` on the secret's ARN (`...:secret:prod/orders-api/db-*`, because of the random suffix). Nothing with `*` as the resource, and no write actions.

**ECS secrets injection instead?** It removes the SDK code and the start-up dependency on SSM, and the module 2 validation of `process.env` still works. I would use it for values that never rotate. For the database password I keep the SDK, because injected values are read once at task start, so a rotation would need a redeploy, and the cache's `refresh()` would have nothing to refresh.
