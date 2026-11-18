---
title: "Authorisation: roles, attributes and ownership"
skills: [access-control]
---

Authentication answers "who are you?". Authorisation answers "may you do this, to this thing, now?". Broken access control has been number one on the OWASP Top 10 since 2021 and is again in the 2025 edition. It is rarely a clever exploit. Usually a route simply forgot to ask the question, or asked it about the wrong thing.

## 401 or 403?

- **401 Unauthorized** means "I do not know who you are": no credentials, or invalid ones. The name is historical; it is about authentication.
- **403 Forbidden** means "I know who you are, and the answer is no".
- **404 Not Found** is often the right answer for someone else's object. A 403 confirms that the id exists, which turns sequential or leaked ids into an oracle.

## RBAC: roles

Role-based access control gives each user one or more roles, and each role a set of permissions:

```ts
const permissions = {
  member: ['invoice:read', 'invoice:create'],
  accountant: ['invoice:read', 'invoice:create', 'invoice:refund'],
  admin: ['invoice:read', 'invoice:create', 'invoice:refund', 'user:manage'],
} as const;
```

Check **permissions** in code, not role names. `if (user.role === 'admin')` scattered through handlers means that adding an "accountant" role is a search through the whole codebase. `can(user, 'invoice:refund')` keeps the mapping in one place.

RBAC is easy to reason about and audit. Its limit: roles say nothing about *which* invoice. "Accountants may refund invoices" really means "invoices of their own company, under 1,000 euros, not older than 90 days".

## ABAC: attributes

Attribute-based access control decides with a rule over attributes of the **subject** (user id, roles, tenant, department), the **resource** (owner, tenant, status, amount) and the **context** (time, IP range, whether MFA was used):

```ts
function canRefund(user: User, invoice: Invoice): boolean {
  return (
    user.permissions.has('invoice:refund') &&
    invoice.tenantId === user.tenantId &&
    invoice.status === 'paid' &&
    invoice.amountCents <= 100_000
  );
}
```

In practice you combine both: RBAC for coarse rights, ABAC rules (ownership, tenant, state) for the objects. For sharing models such as Google Drive, where access flows through folders, teams and links, relationship-based access control (ReBAC, as in Google's Zanzibar paper and tools like OpenFGA) models permissions as a graph. Most products do not need it on day one.

## Where checks belong

Two layers, each with a clear job:

1. **At the edge, per route**: is the caller signed in, and do they have the permission this route needs at all? This is cheap, needs no data, and fits a NestJS **guard**.
2. **At the data, per object**: may this caller touch *this* record? This needs the record, so it belongs in the service or, better, in the query itself.

A guard runs before the handler and sees only the request. It cannot know who owns invoice 812 without loading it. Putting the ownership check in the service means every caller of that service (controllers, queue workers, GraphQL resolvers, the CLI script someone writes next year) gets it for free.

**Deny by default.** Register authentication as a global guard and let routes opt out with `@Public()`. A new route that nobody annotated is then closed, not open. The same idea applies to authorisation: a missing rule should deny.

## Guards and decorators in NestJS

A role guard reads metadata that a decorator attached to the route:

```ts
import { Reflector } from '@nestjs/core';
export const Roles = Reflector.createDecorator<string[]>();
```

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride(Roles, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;                     // no @Roles(): any signed-in user
    const user = context.switchToHttp().getRequest().user;
    if (!roles.includes(user?.role)) throw new ForbiddenException();
    return true;
  }
}
```

```ts
@Roles(['admin'])
@Controller('admin')
export class AdminController { /* ... */ }
```

`getAllAndOverride` looks at the handler first and then the controller, so a method can override its class. Register both guards globally with `APP_GUARD` providers; they run in registration order, so authentication must come first. Otherwise the role guard sees no user and every anonymous request gets 403 instead of 401.

The NestJS documentation now also describes `@nestjs/authorization`, which expresses rules as policy classes checked with `@Can()` on routes and with `AuthorizationService` in services for record-level checks. It follows the same split: route-level rules in a guard, object-level rules where the object is loaded.

## Broken object-level authorisation (BOLA)

BOLA is number one on the OWASP API Security Top 10 (API1:2023). The pattern:

```ts
@Get('invoices/:id')
find(@Param('id') id: string) {
  return this.db.query('SELECT * FROM invoices WHERE id = $1', [id]); // whose invoice?
}
```

The caller is authenticated, the route is allowed for members, and the query is parameterised. It still returns any invoice to anyone who changes the number in the URL. Your frontend never shows other people's ids, but the API does not know about your frontend.

The fix is to make ownership part of the lookup:

```ts
const [invoice] = await this.db.query(
  'SELECT id, customer, amount_cents FROM invoices WHERE id = $1 AND owner_id = $2',
  [id, user.id],
);
if (!invoice) throw new NotFoundException();
```

Now a foreign id behaves exactly like a missing one. List endpoints need the same rule in their `WHERE` clause, not a filter after loading everything.

Random UUIDs instead of sequential ids make guessing harder, but ids leak through URLs, logs, shared links and referrer headers. They are a speed bump, never the check.

Two relatives in the same Top 10:

- **Broken function-level authorisation (API5)**: a member can call an admin-only route, such as `DELETE /users/:id`, because only the admin UI hides the button.
- **Broken object property-level authorisation (API3)**: the caller may see the object but not every field (`password_hash`, `internal_notes`), or may change some fields but not others (`role`, `owner_id`). Mass assignment, covered in the next lesson, lives here.

## Testing authorisation

Write the tests as a matrix: each role (anonymous, member A, member B, admin) against each route, with the expected status. The most valuable row is "member B asks for member A's object", because that is the one a happy-path test never covers. The tasks in this module are checked exactly that way.

## Common mistakes

- Checking authentication and assuming that implies permission.
- Ownership checks in the controller of one route, missing from the next.
- Hiding buttons in the UI instead of enforcing the rule on the server.
- Role names hard-coded across handlers instead of permissions in one place.
- Fetching all rows and filtering in JavaScript, or worse, in the client.
- Returning 403 for other people's objects and so confirming that they exist.
- Trusting a role or user id sent by the client in a body or header.

## Go deeper

- [OWASP API Security Top 10 (2023)](https://api-security.owasp.org/editions/2023/en/0x11-t10/): BOLA, function-level and property-level authorisation, with examples.
- [NestJS: Guards](https://docs.nestjs.com/guards): execution context, `Reflector` and global guards.
- [NestJS: Authorization](https://docs.nestjs.com/security/authorization): policies, `@Can()` and record-level checks in services.
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny by default, least privilege, and why it prefers ABAC and ReBAC to plain RBAC.
