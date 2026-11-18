Design authentication for a small product and defend your choices. Write 500 to 900 words. Use headings, lists or a table; no code is needed.

## The product

**Ledgerly** is bookkeeping for small companies. It has:

- a **web app** on `app.ledgerly.example`, a React single-page app served from the same site as the API at `app.ledgerly.example/api`;
- an **iOS and Android app** that calls the same API;
- **"Sign in with Google"** for companies that use Google Workspace, next to email and password.

Requirements from the founders:

- A user can see their active devices and **log out everywhere** in one click.
- When a customer's admin **disables an employee**, that person must lose access within one minute, on every device.
- Mobile users should not have to log in again more than once a month.
- The team is four engineers. Simple beats clever.

## What to cover

1. **The web app.** Server-side sessions or JWTs? Where does the browser keep whatever proves the user is signed in, with which attributes, and how do you stop CSRF?
2. **The mobile app.** What does the app hold, for how long, and where on the device? How do refresh tokens rotate, and what happens if a refresh token that was already used shows up again?
3. **The two founder requirements.** For each client, how do "log out everywhere" and "disable an employee within a minute" actually work? If you use access tokens, how long can a stolen one still be used?
4. **Sign in with Google from the mobile app.** Walk through the authorisation code flow with PKCE step by step: what the app generates, what goes in the redirect, what comes back and what the app sends to exchange the code. Say what an attacker who intercepts the code cannot do, and why.
5. **ID token vs access token.** After the flow, which token does the app use for what? Which one does your API accept?

## What is assessed

Whether each choice fits its client, whether the revocation story holds up under the one-minute rule, and whether the PKCE walk-through is in the right order and explains the protection. There are no automated checks.
