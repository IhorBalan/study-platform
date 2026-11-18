---
title: TypeScript for the backend
skills: [ts-server-setup, boundary-validation, error-modelling]
---

You know TypeScript from React, where a bundler decides how modules resolve and the data you handle mostly comes from your own API client. On a server there is no bundler by default, Node's own module rules apply, and almost everything that enters the process is untrusted. This lesson covers the set-up and the habits that differ.

## ESM in Node

Node treats a `.js` file as an ES module when the nearest `package.json` contains `"type": "module"`. Without it, `.js` means CommonJS. New backend projects should be ESM.

Node's ESM resolver is stricter than a bundler's:

- A relative import needs the full file name with extension: `import { db } from './db.js'`. There is no extension guessing and no automatic `index.js` for folders.
- Built-ins are imported with the `node:` prefix: `import { readFile } from 'node:fs/promises'`.
- `__dirname` and `require` do not exist. Use `import.meta.dirname`, `import.meta.filename` and `import`.
- Top-level `await` works.

In TypeScript source you write the extension of the **output** file. `./db.js` in `server.ts` refers to the file `db.ts` compiles to. It looks odd for a week and then stops.

## A tsconfig for a server

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "es2024",
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`"module": "nodenext"` makes the compiler apply Node's real resolution rules, including the extension requirement, so what type-checks also runs. It implies the matching `moduleResolution`. Beyond `strict`, three flags pay for themselves on a server:

- `noUncheckedIndexedAccess`: `rows[0]` and `record[key]` have type `T | undefined`. This catches the "first row of an empty result" bug.
- `exactOptionalPropertyTypes`: `{ name?: string }` no longer accepts an explicit `undefined`, which matters when "absent" and "set to nothing" mean different things in a `PATCH`.
- `verbatimModuleSyntax`: forces `import type` for type-only imports, so the emitted JavaScript contains exactly the imports you wrote.

TypeScript 7, the current compiler, is a native implementation and far faster than its predecessors. It makes running `tsc --noEmit` in watch mode and in CI cheap. The options above are unchanged.

## Unknown in, parsed type out

Types vanish at runtime. `JSON.parse` returns `any`, and `req.body as CreateUser` is a claim, not a check. At every boundary (request bodies, query strings, environment variables, responses from other services, rows from a queue) treat the input as `unknown` and **parse** it into a typed value. Inside the boundary, trust the types.

A schema library does the parsing and derives the static type from the same definition. With zod:

```ts
import { z } from 'zod';

const CreateUser = z.object({
  email: z.email(),
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).optional(),
});
type CreateUser = z.infer<typeof CreateUser>;

export function parseCreateUser(input: unknown): CreateUser {
  const result = CreateUser.safeParse(input);
  if (!result.success) throw new ValidationError(result.error.issues);
  return result.data;
}
```

`safeParse` returns a discriminated union instead of throwing, and by default strips keys the schema does not name. One schema gives you the runtime check, the type and readable error details for a `422` response.

## Modelling errors and results

`throw` is invisible in a function's type. Split failures into two groups.

**Expected outcomes** are part of the domain: the email is taken, the balance is too low. Return them as data so the caller must handle them:

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

type RegisterError = { kind: 'email-taken' } | { kind: 'weak-password'; minLength: number };

declare function register(input: CreateUser): Promise<Result<User, RegisterError>>;
```

Narrowing on `ok` and then on `kind` gives exhaustive handling, the same way you narrow a reducer action.

**Unexpected failures** (the database is down, a bug) should throw. Use `Error` subclasses, and keep the original with `new Error('Could not load user', { cause: err })`. A value in a `catch` clause is `unknown` under `strict`, so narrow it with `instanceof` before reading properties. One place near the top of the request handler turns thrown errors into a `500`.

## Parsing configuration

`process.env` is another boundary: every value is `string | undefined`. Parse it once at start-up and export a typed object. If something is missing, crash immediately with a clear message instead of failing on the first request that needs it.

```ts
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url(),
});

export const env = Env.parse(process.env);
```

The rest of the code imports `env` and never touches `process.env`.

## Common mistakes

- Writing `import './db'` or `'./db.ts'` and getting `ERR_MODULE_NOT_FOUND` at runtime. With `nodenext`, write `./db.js`.
- Casting external data with `as` instead of parsing it.
- Reading `process.env.X` all over the code, each time with a different fallback.
- Comparing an environment variable to a boolean. `"false"` is a non-empty string and therefore truthy.
- Throwing for expected domain outcomes, then guessing from the message what happened.
- Treating `catch (e)` as `Error` without narrowing.

## Go deeper

- [Node.js ECMAScript modules](https://nodejs.org/api/esm.html): the resolution rules, `import.meta` and how ESM and CommonJS interoperate.
- [TypeScript TSConfig reference](https://www.typescriptlang.org/tsconfig/): what every compiler option does, including the strictness flags above.
- [TypeScript handbook: Modules](https://www.typescriptlang.org/docs/handbook/modules/introduction.html): why `nodenext` exists and how the compiler models Node's resolver.
- [Zod documentation](https://zod.dev): schema types, `safeParse`, coercion and error formatting.
- [MDN: Error cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause): chaining errors without losing the original.
