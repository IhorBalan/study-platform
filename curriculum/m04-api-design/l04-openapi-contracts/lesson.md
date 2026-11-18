---
title: Describing an API with OpenAPI
skills: [api-openapi]
---

Your frontend team has probably written `type Project = { id: string; name: string }` by hand, copied from a backend response, and watched it drift. An OpenAPI document is the fix: one machine-readable description of every route, parameter, body and error, from which you generate types, clients, docs and checks. The hard part is not writing it. It is keeping it true.

## What an OpenAPI document holds

OpenAPI is a JSON or YAML file. Version 3.1 aligned its schema language with JSON Schema 2020-12, so a schema in the document is an ordinary JSON Schema. (Version 3.2 was published in September 2025; tooling support for it is still catching up, so 3.1 is the safe target.)

```yaml
openapi: 3.1.0
info: { title: Projects API, version: 1.4.0 }
paths:
  /projects/{id}:
    get:
      operationId: getProject
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: The project
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Project' }
        '404':
          description: No such project
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
components:
  schemas:
    Project:
      type: object
      required: [id, name, archivedAt]
      properties:
        id: { type: string }
        name: { type: string, maxLength: 100 }
        archivedAt: { type: [string, 'null'], format: date-time }
```

Note `type: [string, 'null']`. In 3.0 this was `nullable: true`; 3.1 uses the JSON Schema form. `operationId` matters more than it looks: generators use it to name client methods, so treat it as part of the public contract.

## Schema-first or code-first

**Schema-first**: you write the OpenAPI file, review it like code, and both server and clients are built against it. Design discussions happen on the contract, before implementation, and frontend work can start against a mock server on day one. The cost is that nothing stops the server from drifting away from the file; you need tests that check responses against the schema.

**Code-first**: the server code is the source, and the document is generated from it. It cannot drift from the routes, because it is derived from them. The cost is that the document is only as good as the annotations, and API design tends to happen accidentally, one controller at a time.

For a small team with one backend, code-first with a committed, reviewed output file is a good default. Schema-first pays off when several teams or external partners depend on the contract, or when the API is the product.

## Code-first in NestJS 12

`@nestjs/swagger` scans your controllers and builds the document:

```ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('Projects API')
  .setVersion('1.4.0')
  .setOpenAPIVersion('3.1.0')     // the generated document defaults to 3.0.0
  .build();

const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('docs', app, document);   // UI at /docs, JSON at /docs-json
```

Routes, path parameters and status codes come from the decorators you already have. Bodies and responses need a schema:

- **zod and other Standard Schema libraries**: a body declared with `@Body({ schema: CreateProjectSchema })` is picked up and converted, because zod 4 can describe itself as JSON Schema. Responses are declared with `@ApiResponse({ status: 200, standardSchema: ProjectSchema })`. One schema then validates the input and documents it.
- **class-validator DTOs**: properties are described with `@ApiProperty()`, or added automatically by the Swagger CLI plugin, which reads your TypeScript types at compile time. The plugin depends on the TypeScript compiler API, so check that it supports your TypeScript version before relying on it.

Document errors too. A client generated from a spec that lists only `200` has no type for your problem documents and will treat them as `unknown`.

## Generating a typed client

The payoff is on the frontend. `openapi-typescript` turns the document into TypeScript types, and `openapi-fetch` is a thin `fetch` wrapper that uses them:

```sh
npx openapi-typescript ./openapi.json -o ./src/api/schema.d.ts
```

```ts
import createClient from 'openapi-fetch';
import type { paths } from './api/schema.js';

const api = createClient<paths>({ baseUrl: 'https://api.example.com' });

const { data, error } = await api.GET('/projects/{id}', { params: { path: { id: '42' } } });
if (error) console.error(error.detail);   // typed as the 404 problem schema
else console.log(data.name);              // typed as Project
```

Misspell the path, forget the `id` or read a field that does not exist, and the build fails. Other generators (Hey API, Orval) produce full SDKs, React Query hooks or zod schemas from the same document; the principle is the same.

## Keeping the contract in sync

A spec that is generated on a developer's laptop and pasted into a wiki is out of date within a week. Make the pipeline enforce it:

1. **Generate the document in CI without starting a server.** A short script creates the app, calls `createDocument`, writes `openapi.json` and closes the app.
2. **Commit the generated file.** Pull requests then show the contract change next to the code change, and reviewers see "this removes a field" in plain sight. CI regenerates it and fails if the committed copy differs.
3. **Detect breaking changes.** A diff tool such as `oasdiff breaking main.json pr.json` flags removed fields, new required parameters and narrowed types. Fail the build unless the change is deliberate (see the next lesson).
4. **Lint the document.** Spectral or Redocly CLI enforce house rules: every operation has an `operationId`, every error uses `application/problem+json`, every list has a `limit`.
5. **Regenerate clients from the committed file**, in the frontend's build or as a published package, never by hand.

For schema-first projects, the equivalent of step 1 is a test that sends requests to the running app and validates each response against the document.

## Common mistakes

- Documenting only the success response, so generated clients cannot type errors.
- Unstable or missing `operationId`s, which rename client methods on every regeneration.
- A spec published from a laptop instead of generated in CI.
- Hand-written frontend types next to a generated client, which drift again.
- Treating the document as documentation only. It is a contract, and changes to it deserve review like a database migration.

## Go deeper

- [OpenAPI Specification v3.1.1](https://spec.openapis.org/oas/v3.1.1): the full object model.
- [NestJS: OpenAPI](https://docs.nestjs.com/openapi/introduction): `DocumentBuilder`, decorators and the CLI plugin.
- [openapi-typescript and openapi-fetch](https://openapi-ts.dev/introduction): generating types and a typed fetch client.
- [Upgrading from OpenAPI 3.1 to 3.2](https://learn.openapis.org/upgrading/v3.1-to-v3.2.html): what changed in the newest version.
