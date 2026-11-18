---
title: "Build or buy: choosing an auth solution"
skills: [auth-build-or-buy]
---

You now know enough to build login yourself. That is exactly the knowledge you need to decide **not** to, most of the time, and to recognise what you still own when you do not. This lesson lays out what "auth" really includes, compares the three families of options for a Node backend, and ends with the parts no vendor can take off your hands.

## What "auth" actually includes

The login form is the visible 5 percent. A product that grows will need most of this list:

- sign-up, email verification, login, logout, password reset;
- sessions or tokens, device lists, "log out everywhere";
- rate limiting, bot and credential-stuffing defences;
- multi-factor authentication (TOTP, passkeys), backup codes, account recovery;
- social login ("Sign in with Google, GitHub, Apple");
- organisations, invitations, roles inside an organisation;
- **enterprise SSO** (SAML and OIDC with the customer's identity provider) and **SCIM** provisioning, which B2B customers ask for before they sign;
- audit logs, admin impersonation with a trail, account deletion and data export.

Every item is a small project with security edge cases. The question is which of them you want to own.

## Option 1: a library in your app

**Passport** is the long-standing Node option: authentication middleware with hundreds of "strategies" (local username and password, OAuth providers, SAML, JWT bearer). NestJS integrates it through `@nestjs/passport`. Passport answers one question, "is this request authenticated, and as whom?". Users, password hashing, sessions, MFA, resets and UI are all yours to build. It suits teams that want full control and already have the rest, or that need one exotic strategy.

**NestJS's own auth packages.** The NestJS documentation now describes `@nestjs/authentication` (sessions in a `__Host-` cookie with hashed tokens, JWT access tokens with rotating refresh tokens, scrypt password hashing, TOTP, magic links, OIDC providers and API keys, with state in your database through stores you write) and `@nestjs/authorization` (policies, as in lesson 4). If your stack is NestJS, read those pages before reaching for anything else.

**Better Auth** is a framework-agnostic TypeScript library that covers far more of the list: email and password, sessions, social sign-on, rate limiting, two-factor, organisations and access control, with plugins for passkeys, multi-tenancy and SSO. User and session data live **in your own database** through adapters (Drizzle, Prisma and others), with migrations generated for you.

Libraries keep your data and your bill under your control. You also own upgrades, security patches, email delivery, and every policy decision.

## Option 2: a managed provider

Hosted identity services run the whole flow on their infrastructure. Your app redirects to their login (or embeds their components), receives tokens, and verifies them.

| Provider | Known for |
| --- | --- |
| **Clerk** | Ready-made React and Next.js components, user and organisation management with a polished UI |
| **Auth0** (Okta) | Broad feature set and extensibility, long enterprise track record |
| **WorkOS** | Enterprise readiness: SSO, SCIM directory sync, audit logs, an admin portal for your customers' IT teams; AuthKit for the general login |

All three offer social login, MFA, passkeys and organisations; the differences are in developer experience, enterprise features and pricing, which is usually per monthly active user with enterprise SSO connections priced separately. Check current pricing before you commit; it changes often and dominates the long-term decision.

## Option 3: run your own identity server

Keycloak, Ory or Zitadel give you a full OpenID Connect provider that you host. You get managed-provider features without per-user fees, and you take on operating a critical, stateful service. This makes sense for organisations with platform teams or strict data-residency rules. It is rarely the first choice of a four-person startup.

## How to decide

Ask these questions in order:

1. **Who are the customers?** B2B selling to larger companies will need SSO and SCIM. Building SAML well is weeks of work and an ongoing support load; this is where WorkOS-style providers earn their fee.
2. **Where must the data live?** Regulations or customer contracts may rule out a US-hosted vendor, or require the data in your own database.
3. **What does it cost at 10x your users?** Per-user pricing that is free today can exceed an engineer's salary later. Libraries cost engineering time instead.
4. **How much UI do you want to build?** Hosted components save weeks for a small team.
5. **What is the exit plan?** Can you export users, including password hashes in a format you can verify? Can you migrate gradually, with both systems accepting logins for a while?

A common, sensible path: a library or NestJS's own packages for a consumer product, a managed provider when enterprise SSO enters the sales conversation, and self-hosting only with a team to run it.

## What you still own when you buy

A provider tells you **who** the user is. Everything after that is still your code:

- **Token verification.** Check signature, `iss`, `aud` and `exp` on every request, with the provider's JWKS and a maintained library (lesson 3). A misconfigured audience check is your bug, not theirs.
- **The mapping to your users.** Link the provider's stable id (`sub`) to your own user and tenant rows. Do not key your data on email.
- **Authorisation.** Roles may come from the provider, but "may this user see invoice 812?" is your query (lesson 4). Every BOLA in your API is yours.
- **Tenant isolation** (lesson 8) and the rest of the vulnerabilities in lesson 5.
- **Synchronisation.** Users deleted, disabled or moved between organisations at the provider must reach your database, usually through **webhooks**, which you must verify and process idempotently.
- **Session policy in your app.** If you create your own session after the provider login, its lifetime and revocation are yours.
- **Secrets**: the provider's API keys and webhook secrets (lesson 8).
- **Availability.** When the provider is down, nobody logs in. Know their status page and what your app does meanwhile.
- **Compliance and incident response.** You remain responsible to your customers for their data, whoever processes it.

## Common mistakes

- Building auth from scratch for a product whose value is elsewhere, then shipping without resets, MFA or rate limits.
- Buying a provider and assuming authorisation came with it.
- Accepting the provider's tokens without checking `aud`, so tokens for another app work on yours.
- Keying users by email instead of the provider's `sub`.
- Ignoring the provider's webhooks, so disabled users keep access in your app.
- Choosing on today's price without checking the cost at the user count you plan to reach.
- No exit plan: user records and password hashes you cannot export.

## Go deeper

- [NestJS: Authentication](https://docs.nestjs.com/security/authentication): the built-in package, its guards and stores.
- [NestJS: Passport recipe](https://docs.nestjs.com/recipes/passport): how Passport strategies plug into Nest guards.
- [Better Auth documentation](https://www.better-auth.com/docs/introduction): features, plugins and database adapters.
- [WorkOS documentation](https://workos.com/docs): what enterprise SSO, SCIM and audit logs involve, even if you choose another vendor.
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): a checklist to hold any option against.
