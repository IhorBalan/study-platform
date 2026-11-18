---
title: Configuration and environments
skills: [nest-config]
---

The same build of your API runs on your laptop, in CI and in production. What differs is configuration: which database, which port, which secrets. Getting that boundary right means one artefact for every environment, and no surprises an hour after a deploy.

## Config lives in the environment

The twelve-factor rule is simple: anything that varies between deployments comes from environment variables, not from code. A quick test is whether you could make the repository public right now without leaking a credential.

On the frontend you have met `import.meta.env.VITE_API_URL`. Those values are baked in at build time and shipped to every browser, so they are never secret. Server configuration is the opposite: it is read when the process starts, it stays on the server, and the same compiled code can be started with different values.

For local work, keep values in a `.env` file and let Node load it. No package is needed:

```sh
node --env-file=.env dist/main.js
```

## Parse once, fail fast

`process.env` is a bag of optional strings. `process.env.PORT` has the type `string | undefined`, `"abc"` is a legal value, and a typo in a name gives you `undefined` without a word. If code reads `process.env` wherever it needs something, a missing `DATABASE_URL` shows up as a crash in the first request that touches the database, possibly long after the deploy was declared healthy.

So treat the environment as untrusted input, like a request body. Parse and validate all of it once, at start-up, and refuse to start if it is wrong:

```ts
// src/config/env.ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof EnvSchema>;
export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
```

Three details carry the weight. Environment values are strings, so numbers are coerced before they are checked. The error lists every problem, not only the first, so one failed deploy is enough to fix them all. And the message contains variable names and rules, never the received values, because a start-up log is the last place a mistyped secret should appear.

A process that exits at start-up is the good outcome. The orchestrator sees the failure, keeps the previous version running, and you read one clear message.

## A typed config provider

Now make the parsed object injectable:

```ts
// src/config/config.module.ts
import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
```

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

@Injectable()
export class MailService {
  constructor(@Inject(ENV) private readonly env: Env) {}
}
```

Nest runs the factory while it builds the container, so `NestFactory.create()` rejects before the server listens. Services receive an `Env` whose `PORT` is a `number`, with autocomplete and no `undefined`. Tests override the `ENV` provider and never touch `process.env`. After this, `src/config/` is the only place in the codebase that mentions `process.env`.

Nest also has an official `@nestjs/config` package with `.env` loading, namespaces and a `ConfigService`. It solves the same problem with more features; the idea of validating at start-up is the same. Check the current docs if you adopt it.

## Secrets hygiene

- `.env` is git-ignored. Commit a `.env.example` with names and harmless placeholder values.
- Never log the config object, and never include a secret's value in an error message. Log names.
- Do not return configuration from an endpoint, however handy a `/debug/config` route seems.
- Give a secret no default. A default secret is a published secret.
- In production, secrets come from the platform's secret store and reach the process as environment variables or mounted files. They do not live in the image.

## Environments

Keep `NODE_ENV` to a short, validated list, and branch on it as little as possible. Each `if (env.NODE_ENV === 'production')` is a code path your tests never run. Prefer a variable per behaviour, such as `LOG_LEVEL=debug` or `CORS_ORIGIN=http://localhost:5173`, so that an environment is just a set of values and staging can copy production's behaviour by copying its settings.

## Common mistakes

- Reading `process.env` throughout the codebase, each place with its own fallback.
- `Number(process.env.PORT)` without a check. `NaN` travels a long way before anything breaks.
- Parsing booleans with `Boolean(value)` or `z.coerce.boolean()`. The string `"false"` is truthy. Compare with `'true'` explicitly.
- Defaults that make production work by accident, such as a database URL pointing at localhost.
- Committing `.env`, or printing the whole environment "just for debugging".
- Validating lazily, on first use, so that the failure arrives with a user's request.

## Go deeper

- [The Twelve-Factor App: Config](https://12factor.net/config): the original argument for configuration in the environment.
- [Node.js: command-line options](https://nodejs.org/api/cli.html): `--env-file` and `--env-file-if-exists`.
- [NestJS: Configuration](https://docs.nestjs.com/techniques/configuration): the official `@nestjs/config` module and its validation hooks.
- [NestJS: Custom providers](https://docs.nestjs.com/fundamentals/custom-providers): factory providers, used here for the config token.
- [Zod](https://zod.dev): coercion, defaults and error formatting.
