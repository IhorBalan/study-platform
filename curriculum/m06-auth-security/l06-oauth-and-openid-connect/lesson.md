---
title: OAuth 2.1 and OpenID Connect
skills: [oauth-oidc]
---

"Sign in with Google" and "Connect your GitHub account" look like the same button. Underneath are two related protocols. **OAuth** lets an app act on your behalf at another service without ever seeing your password. **OpenID Connect** (OIDC) is a thin layer on top that also tells the app who you are. Interviewers love the difference, and getting the flow right matters because every step blocks a specific attack.

## The four roles

| Role | Example |
| --- | --- |
| **Resource owner** | You, the user |
| **Client** | The app that wants access: your web app, a mobile app |
| **Authorisation server** | Issues tokens after you log in and consent: Google's accounts service, Keycloak, Auth0 |
| **Resource server** | The API that accepts the tokens: Google Calendar's API, or your own API |

The client never sees your Google password. It gets an **access token** that says "this client may read this user's calendar until 11:00", limited by **scopes** such as `calendar.readonly`.

Clients come in two kinds. A **confidential client** runs on a server and can keep a secret. A **public client** (a single-page app, a mobile app) ships its code to users, so any embedded "secret" is public.

## OAuth 2.1

OAuth 2.0 (RFC 6749, 2012) grew a decade of extensions and security advice. OAuth 2.1 folds the good parts into one document. It is still an IETF draft, but its rules are already what current best practice (RFC 9700) asks for:

- The **authorisation code flow with PKCE** is the flow for users, for every client type.
- The **implicit flow** (tokens returned in the URL fragment) and the **password grant** (the app collects your password) are gone.
- Redirect URIs must match **exactly**, with no wildcards.
- Bearer tokens never travel in query strings.
- Refresh tokens for public clients must be rotated or bound to the client.

## The authorisation code flow with PKCE, step by step

PKCE ("pixie", Proof Key for Code Exchange, RFC 7636) proves that whoever redeems the code is whoever started the flow.

**1. The client creates a verifier and its challenge.**

```ts
import { createHash, randomBytes } from 'node:crypto';

const codeVerifier = randomBytes(32).toString('base64url');          // secret, kept by the client
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
const state = randomBytes(16).toString('base64url');                 // ties the callback to this attempt
const nonce = randomBytes(16).toString('base64url');                 // OIDC: ties the ID token to it
```

It stores `codeVerifier`, `state` and `nonce` (in the server-side session, or in secure storage on a phone).

**2. The client sends the browser to the authorisation server.**

```http
GET /authorize?response_type=code
  &client_id=ledgerly-web
  &redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Fcallback
  &scope=openid%20email%20profile
  &state=Q2x...&nonce=n0X...
  &code_challenge=E9Mel...&code_challenge_method=S256 HTTP/1.1
Host: accounts.example-idp.com
```

Only the **challenge**, a hash, leaves the client.

**3. The user logs in and consents** at the authorisation server, on its own domain. Your app never sees the password, MFA prompt or passkey.

**4. The authorisation server redirects back** with a short-lived, single-use code:

```http
HTTP/1.1 302 Found
Location: https://app.example.com/auth/callback?code=SplxlOB...&state=Q2x...
```

The client checks that `state` matches what it stored. A mismatch means the callback did not come from a flow this user started (login CSRF), so it stops.

**5. The client exchanges the code** in a direct back-channel request, sending the **verifier**:

```http
POST /token HTTP/1.1
Host: accounts.example-idp.com
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=SplxlOB...&redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Fcallback
&client_id=ledgerly-web&code_verifier=dBjftJ...
```

A confidential client also authenticates itself here (client secret or a signed assertion). The server hashes the verifier, compares it with the challenge from step 2, and only then returns tokens:

```json
{ "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 600,
  "refresh_token": "8xLO...", "id_token": "eyJ..." }
```

**What PKCE buys.** Codes leak: through a malicious app registered for the same custom URL scheme on a phone, browser history, logs or referrer headers. An attacker with the code but not the verifier cannot redeem it, and the verifier never left the client. That is why PKCE is required even for confidential clients now: it also stops an attacker from injecting a stolen code into someone else's session.

## OpenID Connect: identity on top

OAuth alone says "this token may read a calendar". It does not say who the user is. Using an access token as proof of identity is a classic mistake: a token issued to another app for the same user would log someone in to yours.

OIDC adds:

- the `openid` scope, which turns an OAuth request into an OIDC one;
- an **ID token**, a signed JWT about the login itself;
- a `userinfo` endpoint for profile data;
- **discovery** at `/.well-known/openid-configuration`, which lists the endpoints and the JWKS URL.

The ID token's claims, and what the client checks:

| Claim | Check |
| --- | --- |
| `iss` | Exactly the provider you expect |
| `aud` | Contains your `client_id` |
| `exp`, `iat` | Not expired, not from the far past |
| `nonce` | Equals the nonce you stored in step 1 |
| `sub` | The user's stable id at this provider |

Plus the signature, with a key from the provider's JWKS.

### ID token vs access token

| | ID token | Access token |
| --- | --- | --- |
| For | The client | The resource server (API) |
| Says | "This user just signed in to you" | "The bearer may do these scopes" |
| Audience | Your `client_id` | The API |
| Send to an API? | No | Yes |

## What "Sign in with X" does

When you add "Sign in with Google" to your app, your backend is an OIDC client. After step 5 it verifies the ID token and reads `iss` and `sub`. It then finds or creates the local user linked to that `(iss, sub)` pair and starts **its own session**, exactly as after a password login. Google's tokens are not your session.

Two details matter. Link accounts by `(iss, sub)`, never by email alone: emails change, and some providers let users set addresses they do not own. If you do link an existing account by email, require the `email_verified` claim and, ideally, a login to the existing account first. And if you do not need to call Google's APIs later, you do not need to keep Google's access token at all.

Use a certified OIDC client library rather than hand-building these requests. The value of this walk-through is knowing what the library does, so you can configure it and debug it.

## Practise on your own: a local Keycloak

Not part of the tasks; for when you want to see real traffic. Keycloak is an open-source authorisation server that runs in one container:

```sh
docker run -p 127.0.0.1:8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.8.2 start-dev
```

The tag is the one in Keycloak's guide at the time of writing; use the current one from that page.

Then, following Keycloak's getting-started guide: create a realm, a user with a password, and an OpenID Connect client with "Standard flow" enabled and your redirect URI. Open `http://localhost:8080/realms/<realm>/.well-known/openid-configuration` to see discovery. Run the flow from a small script or with an OIDC client library, watch each redirect in the browser's network tab, decode the ID token, and try to redeem a code twice or with a wrong verifier.

## Common mistakes

- Using the implicit flow or the password grant in new code.
- Skipping PKCE because "we are a confidential client".
- Not checking `state` on the callback, or `nonce` in the ID token.
- Treating an access token as proof of who the user is.
- Sending the ID token to your API as a bearer token.
- Linking accounts by email without `email_verified`.
- Wildcard or prefix-matched redirect URIs.

## Go deeper

- [The OAuth 2.1 draft](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/): the consolidated specification and what it removed.
- [RFC 7636: PKCE](https://www.rfc-editor.org/rfc/rfc7636): the verifier and challenge in detail.
- [RFC 9700: OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700): the attacks behind each rule.
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html): ID tokens and their validation rules.
- [Keycloak: getting started with Docker](https://www.keycloak.org/getting-started/getting-started-docker): the local practice set-up above.
