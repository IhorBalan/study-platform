---
title: Passkeys and WebAuthn
skills: [passkeys]
---

Passwords fail in two ways that no hashing fixes: people reuse them, and people type them into convincing fake sites. **Passkeys** remove both. The user's device holds a private key, your server holds only the matching public key, and the browser makes sure the key is only ever used on your domain. This lesson explains what happens in the two "ceremonies", what your server stores and checks, and where passkeys fit next to passwords.

## The idea in one paragraph

A passkey is a public-key credential created by an **authenticator**: the phone or laptop itself (Touch ID, Windows Hello, Android screen lock), a password manager, or a hardware security key. The private key never leaves the authenticator. Each credential is bound to a **relying party ID** (RP ID), which is your domain, such as `example.com`. To log in, your server sends a random challenge, the authenticator signs it after the user unlocks it, and the server verifies the signature with the stored public key. There is no shared secret to steal from your database, nothing to reuse elsewhere, and nothing a phishing site can replay, because the browser will not use an `example.com` credential on `examp1e.com`.

Most passkeys today are **synced**: Apple, Google and password managers back them up and copy them across the user's devices. That is what made them usable for ordinary people. A passkey on a single hardware key is **device-bound**.

**WebAuthn** is the browser API and server-side rules behind all this (a W3C standard; Level 3 became a Recommendation in 2026). It is part of the FIDO2 family together with CTAP, the protocol between browser and external authenticator.

## Registration: creating a passkey

1. **Server: create options.** A fresh random challenge (at least 16 bytes), your RP ID and name, a stable random **user handle** (not the email), the algorithms you accept, the credentials the user already has (so the device does not create a duplicate), and whether user verification is required. Store the challenge in the session.
2. **Browser:** `navigator.credentials.create({ publicKey: options })`. The user confirms with a fingerprint, face or PIN.
3. **Authenticator:** generates a key pair scoped to the RP ID and returns a credential id, the public key and signed data.
4. **Browser → server:** an attestation response containing:
   - `clientDataJSON`: the type (`webauthn.create`), the challenge and the **origin** the browser saw;
   - `authenticatorData`: a hash of the RP ID, flags (user present, user verified, backup eligible, backed up), a signature counter, and the new credential id and public key.
5. **Server: verify, then store.** Check that the type is right, the challenge is the one you issued, the origin is your origin, the RP ID hash matches your RP ID, and the user-present (and, if you required it, user-verified) flags are set. Then save the credential.

What to store per credential:

| Field | Why |
| --- | --- |
| Credential id | To find the credential at login |
| Public key | To verify signatures |
| User id | Which account it belongs to |
| Signature counter | To spot some cloned device-bound keys (synced passkeys usually report 0) |
| Transports | Hints for the browser next time (`internal`, `usb`, `hybrid`) |
| Backup flags | Whether it is synced, useful for account-recovery decisions |
| Name, created, last used | So users can manage their passkeys |

**Attestation** (a statement from the authenticator's maker about the device model) is optional. Consumer apps usually request `none`. It matters only when policy demands specific hardware.

## Authentication: using a passkey

1. **Server: create options**: a fresh challenge, your RP ID, and optionally the user's credential ids. Leave them out for a "username-less" login where the device offers its passkeys for your site.
2. **Browser:** `navigator.credentials.get({ publicKey: options })`. With `mediation: 'conditional'`, passkeys appear in the browser's autofill on the username field, which is the smoothest UX.
3. **Authenticator:** signs `authenticatorData` plus a hash of `clientDataJSON` with the private key.
4. **Server: verify.** Look up the credential by id, then check: type `webauthn.get`, your challenge, your origin, the RP ID hash, the flags, and the **signature** with the stored public key. Update the counter and "last used". Then start a normal session (lesson 2).

The challenge is single-use and short-lived. Delete it once used, so a captured response cannot be replayed.

## In code: use a library

The responses are CBOR-encoded with COSE keys and several signature formats. Parsing them yourself is a project, not a feature. SimpleWebAuthn is the usual choice in TypeScript:

```ts
// server
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';

const options = await generateRegistrationOptions({
  rpName: 'Ledgerly', rpID: 'ledgerly.example', userName: user.email,
  attestationType: 'none',
  excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
});
await saveChallenge(session, options.challenge);
// ... later, with the browser's response:
const { verified, registrationInfo } = await verifyRegistrationResponse({
  response: body, expectedChallenge: await takeChallenge(session),
  expectedOrigin: 'https://ledgerly.example', expectedRPID: 'ledgerly.example',
});
if (verified) await savePasskey(user.id, registrationInfo.credential); // id, publicKey, counter
```

```ts
// browser
import { startRegistration } from '@simplewebauthn/browser';
const response = await startRegistration({ optionsJSON: await getOptionsFromServer() });
```

Authentication mirrors it with `generateAuthenticationOptions`, `startAuthentication` and `verifyAuthenticationResponse`, which takes the stored credential.

## Where passkeys fit

- **Next to passwords first.** Offer "create a passkey" after a successful login, and passkey login on the sign-in page. Keep the password path until most active users have a passkey.
- **More than one per user.** Phone, laptop, a hardware key. Let users list, name and remove them.
- **Strong by themselves.** A passkey with user verification combines something you have (the device) with something you are or know (biometric or PIN). Many products accept it as multi-factor on its own.
- **Recovery is the hard part.** Lost all devices? Your recovery path (email link, support, backup codes) is now the weakest door into the account, so design it as carefully as login. Synced passkeys make this rarer, not impossible.
- **The RP ID is a commitment.** Credentials work on that domain and its subdomains. Moving from `example-app.com` to `example.com` means users re-register. Choose the registrable domain you will keep.

## Common mistakes

- Reusing challenges or not storing them server-side.
- Skipping the origin or RP ID check because "the library handles it" while passing it the wrong expected values.
- Using the email address as the WebAuthn user handle.
- Allowing only one passkey per account.
- Treating passkeys as a reason to make account recovery easy.
- Rejecting logins when the counter is 0 or does not increase; synced passkeys often do not count.

## Go deeper

- [passkeys.dev](https://passkeys.dev/): implementation guidance, UX patterns and platform support from the FIDO Alliance and W3C community.
- [Web Authentication Level 3 (W3C)](https://www.w3.org/TR/webauthn-3/): the ceremonies and every verification step.
- [MDN: Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API): the browser API and its options.
- [SimpleWebAuthn](https://simplewebauthn.dev/): server and browser packages used above.
