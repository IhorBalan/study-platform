---
title: Versioning and evolving an API
skills: [api-versioning]
---

A web frontend updates the moment you deploy it. An API client does not. A mobile app from last spring is still installed on thousands of phones, a partner's integration was written once and forgotten, and a cron job on someone's server calls you every hour. Evolving an API means changing it while all of those keep working. Version numbers are the last resort, not the first tool.

## What breaks a client

A change is **breaking** when a correct client written against the old contract stops working. Most changes fall clearly on one side:

| Safe (additive) | Breaking |
| --- | --- |
| Add an endpoint | Remove or rename an endpoint or field |
| Add an optional request field | Make an optional request field required |
| Add a response field | Change a field's type (`"42"` to `42`, object to array) |
| Add a new error `type` for a new situation | Change the meaning of an existing field or status code |
| Relax a validation rule | Tighten validation (shorter max length, fewer allowed values) |
| Raise a rate limit | Change the default sort order or page size |

Two entries surprise people. Adding a value to an enum in a **response** can break clients whose `switch` has no default branch, and TypeScript clients generated with a closed union will fail to compile on regeneration. Document enums as open ("clients must ignore unknown values") from the start. And changing default behaviour, such as sort order, breaks clients that relied on it even though no field changed.

The rule that makes additive change work is the **tolerant reader**: clients ignore fields they do not know. Ask for it in your docs, and build your own clients that way. A zod schema with `z.strictObject` on a response is the opposite of a tolerant reader.

## Evolve without a new version

Most changes that seem to need a version can be done additively. Take a classic one: a project had one `owner`, and now it can have several.

```json
{ "id": "p_42", "owner": { "id": "u_1", "name": "Ada" } }
```

Instead of changing `owner` into an array:

1. **Add** `owners` next to `owner`. Old clients ignore it; new clients use it. Fill `owner` with the first owner, so old clients still see a sensible value.
2. **Accept both on write** for a while: a request with `owner` sets a single owner, one with `owners` sets the list, one with both is a `400`.
3. **Deprecate** `owner` in the OpenAPI document (`deprecated: true`) and the changelog.
4. **Measure** who still reads or sends `owner`, using logs or metrics tagged by client id or app version.
5. **Remove** it after the announced date, when usage has dropped to what you are willing to break.

This expand-and-contract sequence is the same idea as a zero-downtime database migration, and it usually beats a new version.

## Telling clients a change is coming

Two standard response headers make deprecation machine-readable:

```http
HTTP/1.1 200 OK
Deprecation: @1767225600
Sunset: Wed, 30 Jun 2027 23:59:59 GMT
Link: <https://api.example.com/docs/migrate-owners>; rel="deprecation"
```

- **`Deprecation`** (RFC 9745) says the resource is deprecated, or will be, as of a date. The value is a structured-field date: `@` followed by Unix seconds.
- **`Sunset`** (RFC 8594) says when the resource is expected to stop working. It uses the familiar HTTP date format and must not be earlier than the deprecation date.
- **`Link` with `rel="deprecation"`** points to a page that explains the migration.

Headers are for code: SDKs and API gateways can log a warning whenever they see them. People also need an email, a changelog entry and a dashboard of who is still calling the old thing. Send these headers per endpoint, or per response that used a deprecated parameter, not on every response.

## When you need a real version

Some changes cannot be additive: a new authentication model, a different resource model, a fundamentally different error format. Then you run two versions side by side and migrate clients between them. The main styles:

| Style | Example | Notes |
| --- | --- | --- |
| URI | `GET /v2/projects` | Visible, easy to route, cache and test with `curl`. The most common choice. |
| Header | `Api-Version: 2` | Clean URLs, but invisible in logs and browser address bars unless you add it. |
| Media type | `Accept: application/vnd.example.v2+json` | Very RESTful, the most awkward for clients. |
| Date-based | `Stripe-Version: 2026-10-28` | Each account is pinned to the version it started on; the server translates old shapes. Powerful, but expensive to run. |

A version is a **major** version of the whole contract. Do not version single endpoints independently (`/v2/projects` next to `/v1/tasks` that returns v1 projects), or nobody can say which shapes belong together.

NestJS supports the first three styles and a custom one:

```ts
// main.ts
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
```

```ts
@Controller({ path: 'projects', version: '2' })   // GET /v2/projects
export class ProjectsV2Controller {}

@Controller('projects')                             // GET /v1/projects (the default version)
export class ProjectsController {
  @Get(':id')
  @Version(['1', '2'])                              // one handler serves both
  findOne(@Param('id') id: string) {}
}
```

Keep the business logic shared and put only the mapping between internal models and each version's shape in version-specific code. Two full copies of a service is how bugs get fixed in v2 but not in v1.

## Versioning is a promise about time

Every version you run is code you maintain, test and secure. Before launching a public API, decide and publish:

- how long a deprecated version or field stays alive after notice (for example six or twelve months);
- where changes are announced;
- what you consider breaking (the table above, in your words).

For an API used only by your own web app, you may need almost none of this: deploy the server and the client together and change freely. The moment a mobile app or an outside developer depends on it, the rules apply.

## Common mistakes

- Creating `/v2` for a change that could have been additive.
- Renaming a field "because the new name is better" with no transition period.
- Response enums documented as closed, so adding a value breaks generated clients.
- Deprecating without measuring, then either breaking active clients or never removing anything.
- Separate version numbers per endpoint.
- Copying the whole service per version instead of mapping at the edge.

## Go deeper

- [RFC 9745: The Deprecation HTTP Response Header Field](https://www.rfc-editor.org/rfc/rfc9745): syntax and the `deprecation` link relation.
- [RFC 8594: The Sunset HTTP Header Field](https://www.rfc-editor.org/rfc/rfc8594): announcing when a resource goes away.
- [NestJS: Versioning](https://docs.nestjs.com/techniques/versioning): URI, header, media type and custom versioning.
- [RFC 9205: Building Protocols with HTTP](https://www.rfc-editor.org/rfc/rfc9205): IETF guidance on designing HTTP APIs, including extensibility.
