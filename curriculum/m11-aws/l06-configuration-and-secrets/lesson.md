---
title: Configuration and secrets with SSM and Secrets Manager
skills: [aws-config-secrets]
---

Module 2 taught you to read configuration in one place, validate it and fail fast. Module 6 taught you to keep secrets out of the repository. On AWS the values themselves live in two services: **SSM Parameter Store** for configuration and **Secrets Manager** for credentials that rotate. This lesson covers both, how the app loads them at start-up, and how rotation works without an outage.

## Why not just environment variables?

Environment variables are still the interface between the platform and your process, and that is fine. The question is where the values come from. Typed into a task definition by hand, they have no history, no access control beyond "who can edit the deployment", and secrets show up in plain text in the console and in every `describe` call. Baked into the container image, they are worse: anyone who can pull the image can read them, and changing one means a rebuild.

The rule from module 1 stands: **the image is the same in every environment, and contains no configuration and no secrets.** The values live in a store with IAM permissions, encryption and an audit trail, and reach the process at start-up.

## SSM Parameter Store

Parameter Store, part of AWS Systems Manager, is a hierarchical key-value store:

```text
/orders-api/prod/port                    String        8080
/orders-api/prod/log-level               String        info
/orders-api/prod/feature/new-checkout    String        true
/orders-api/prod/allowed-origins         StringList    https://shop.example,https://admin.example
/orders-api/prod/stripe/webhook-secret   SecureString  (encrypted with KMS)
```

Three types: `String`, `StringList` (comma-separated) and `SecureString`, which is encrypted with a KMS key. Standard parameters hold up to 4 KB and cost nothing to store; advanced parameters are larger, support policies such as expiry, and are billed.

The hierarchy is the useful part. One call reads a whole subtree:

```ts
import { SSMClient, GetParametersByPathCommand, type Parameter } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

async function readTree(path: string): Promise<Parameter[]> {
  const all: Parameter[] = [];
  let NextToken: string | undefined;
  do {
    const page = await ssm.send(new GetParametersByPathCommand({
      Path: path,
      Recursive: true,
      WithDecryption: true,
      NextToken,
    }));
    all.push(...(page.Parameters ?? []));
    NextToken = page.NextToken;
  } while (NextToken);
  return all;
}
```

Three details trip people up:

- **Pagination.** A page holds at most 10 parameters. Code that reads one page works in development with eight parameters and silently drops the eleventh in production.
- **`WithDecryption: true`.** Without it, a `SecureString` comes back as ciphertext, which your app will happily use as a password. The role also needs `kms:Decrypt` on the key.
- **`Recursive: true`.** Without it, only direct children of the path are returned, not `/feature/new-checkout`.

IAM can grant a path: `arn:aws:ssm:eu-central-1:123456789012:parameter/orders-api/prod/*` lets the production API read its own parameters and nothing else.

Parameter Store has a modest default API throughput. Read the tree once at start-up rather than calling `GetParameter` per value, and never on every request.

## Secrets Manager

Secrets Manager stores secrets (often a JSON object) and adds what Parameter Store lacks: **rotation**, **versions with staging labels**, cross-account sharing and replication across regions. It costs a small monthly fee per secret plus API calls, so it is worth it for credentials that rotate, not for a log level.

```ts
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});
const res = await sm.send(new GetSecretValueCommand({ SecretId: 'orders-api/prod/db' }));
const db = JSON.parse(res.SecretString ?? '{}'); // { username, password, host, port, dbname }
```

Each value is a **version**. Labels point at versions: `AWSCURRENT` is what readers get by default, `AWSPREVIOUS` is the version before it, and `AWSPENDING` exists during a rotation.

### How rotation works

Rotation runs a Lambda function (AWS provides ready-made ones for RDS, Aurora and others, and RDS can manage its master password in Secrets Manager directly) in four steps:

1. **createSecret**: generate a new password and store it as `AWSPENDING`.
2. **setSecret**: change the password in the database.
3. **testSecret**: log in with the pending value.
4. **finishSecret**: move `AWSCURRENT` to the new version; the old one becomes `AWSPREVIOUS`.

Between steps 2 and 4 your running app still holds the old password. The **alternating users** strategy avoids any failure there: two database users take turns, so the old credentials stay valid while the new ones are rolled out. With a single user, your app must cope with a failed login by fetching the secret again.

That gives the application its part of the contract:

- **Cache** the secret in memory (a few minutes), so you do not call Secrets Manager per request.
- On an **authentication failure**, refresh the secret once and retry. A new connection pool with the new password is usually enough.
- Never log the value, and never put it in an error message.

## Loading configuration at start-up

Put the loading in one function that runs before the app accepts traffic:

```ts
import { z } from 'zod';

const Config = z.object({
  port: z.coerce.number().int().min(1).max(65535),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  database: z.object({ url: z.string().startsWith('postgres://') }),
});
export type Config = z.infer<typeof Config>;

export async function loadConfig(): Promise<Config> {
  const env = process.env.APP_ENV ?? 'dev';
  const params = await readTree(`/orders-api/${env}/`);
  const byName = new Map(params.map((p) => [p.Name!.slice(`/orders-api/${env}/`.length), p.Value!]));
  const secret = JSON.parse((await sm.send(new GetSecretValueCommand({ SecretId: `orders-api/${env}/db` }))).SecretString!);
  const result = Config.safeParse({
    port: byName.get('port'),
    logLevel: byName.get('log-level'),
    database: {
      url: `postgres://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port}/${secret.dbname}`,
    },
  });
  if (!result.success) {
    // Name the fields, never the values: they may be secrets.
    throw new Error(`Invalid configuration: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  return result.data;
}
```

In NestJS, provide it with an async factory so the container cannot start without it:

```ts
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
```

`NestFactory.create` awaits the factory. A missing parameter or a wrong type throws before `listen`, the container exits, and the deployment's health check keeps the old version running. That is the fail-fast behaviour you want. A process that starts with half its configuration fails later, on a customer's request.

Note `encodeURIComponent` around the password: generated passwords contain `@`, `/` and `:`, which break a connection URL.

### The platform alternative

ECS can inject both kinds of value as environment variables: the task definition's `secrets` section takes a parameter or secret ARN per variable, and the agent (with the task execution role) fetches them when the task starts. Your app then only reads `process.env`, and the module 2 validation applies unchanged. The trade-off: values are read once per task start, so a rotated secret reaches the app only when tasks are replaced. Fetching with the SDK, as above, lets the app refresh without a restart. Lambda offers a parameters-and-secrets extension that caches values next to the function for the same purpose.

## Parameter Store or Secrets Manager?

| | Parameter Store | Secrets Manager |
|---|---|---|
| Typical content | Config, feature flags, non-rotating secrets | Database credentials, API keys that rotate |
| Rotation | None built in | Built in, with Lambda |
| Versions | History, labels | Staging labels (`AWSCURRENT`, `AWSPREVIOUS`) |
| Cost | Standard tier free | Per secret per month, plus calls |

Many teams use Parameter Store for everything except database credentials, which Secrets Manager rotates.

## Common mistakes

- Reading one page of `GetParametersByPath` and losing parameters past the tenth.
- Forgetting `WithDecryption`, so a SecureString's ciphertext becomes the password.
- Fetching a secret on every request instead of caching it.
- Printing the configuration object, or a validation error containing a value, to the logs.
- Building a connection URL without encoding the password.
- Secrets in the image, in the repository or typed in plain text into a task definition.

## Go deeper

- [AWS Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html): types, hierarchies, tiers and policies.
- [Rotate Secrets Manager secrets](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html): rotation functions and strategies.
- [Pass sensitive data to an ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html): the task definition's `secrets` section.
- [NestJS configuration](https://docs.nestjs.com/techniques/configuration): async providers and config modules.
