# Password hashing with scrypt

Try it with `node demo.mjs` and run the tests with `npm test`. Node built-ins only; there is nothing to install.

## Notes on my solution

One hash with N = 2^17, r = 8, p = 1 takes about 250 ms on my laptop and needs 128 * N * r = 128 MiB of memory while it runs. The memory is the point: an attacker with a GPU can run thousands of SHA-256 guesses in parallel, but not thousands of 128 MiB scrypt guesses. The cost also limits us: ten logins at the same moment need over a gigabyte, so login needs a rate limit and the threadpool size matters.

For a new production service I would use argon2id through a maintained native package, with at least m = 19 MiB, t = 2, p = 1 (OWASP's minimum), tuned so a hash takes a few hundred milliseconds on our servers. Argon2id won the Password Hashing Competition, is the first choice in RFC 9106 and OWASP's cheat sheet, and lets memory and time be tuned separately. scrypt is the right choice when only Node built-ins are allowed, as here, and it is still on OWASP's list.

The encoded parameters let us raise the cost later: `login` notices an old hash after a successful login and returns a new one to store.
