# Request logging

```sh
npm install
npm start
npm test
npm run typecheck
```

## Notes

**Unchecked request ids.** The id is copied into every line of the request. A client could send a newline and a fake JSON line (log injection), a megabyte of text that inflates storage, or a value that breaks a log query. The middleware accepts only 1 to 64 characters from a small alphabet and generates a UUID for anything else.

**Never log:** passwords and password hashes, session cookies and bearer tokens, API keys and webhook secrets, full card numbers, and request bodies in general, since they carry whatever personal data a form collects. Email addresses are personal data too: the signup line logs the user id instead, so a deletion request does not have to reach into the log archive.

**Defence in depth.** The call sites no longer pass the body or headers to the logger. The `redact` paths in `src/logger.ts` are a second layer for the mistake someone will make later.

**Next field.** The trace id of the active OpenTelemetry span. With it, a log line in the log tool links straight to the trace that shows where the time went, and the request id stays as the id that support can ask a customer for.
