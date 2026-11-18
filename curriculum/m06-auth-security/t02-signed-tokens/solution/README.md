# Signed tokens by hand

Try it with `node demo.mjs` and run the tests with `npm test`. Node built-ins only; there is nothing to install.

## Notes on my solution

The header is written by whoever made the token, and before the signature is checked that may be an attacker. If the verifier lets the header choose, two attacks open up. With `alg: "none"` the attacker sends no signature at all and some libraries accepted it. With `alg: "HS256"` against a server that expects RS256, the attacker signs with HMAC using the server's public key as the secret, and a verifier that passes "the key" to whatever algorithm the header names accepts it. So the server fixes the algorithm (or an allow-list tied to each key) and refuses anything else before it looks at the signature.

Checks run in this order: shape, algorithm, signature, then claims. Nothing in the payload is trusted until the signature matches.

What `jose` gives that this module does not:

- Asymmetric algorithms (ES256, EdDSA, RS256) and JWKS fetching with caching, so other services can verify without holding the signing secret.
- Key ids (`kid`) and key rotation, plus the full set of claim checks (`iss`, `nbf`, clock tolerance, `aud` arrays, `typ`) and years of fixes for edge cases reported against JWT libraries.
