# Page params: tests

`src/page-params.ts` parses `limit`, `offset` and `sort` from a list endpoint's query string. It is correct. Your job is to write the tests in `test/page-params.test.ts` that would catch it if someone broke it.

Node runs TypeScript test files directly by stripping the types, so you need no install to run the tests:

```sh
npm test
```

`npm install` is only for editor types and `npm run typecheck`.

The tests use Node's built-in runner (`node:test` and `node:assert/strict`). Everything you write maps one-to-one to Vitest: `describe` and `test` are the same, `assert.equal(a, b)` is `expect(a).toBe(b)`, `assert.deepEqual` is `toEqual`, and `assert.throws(fn, RangeError)` is `expect(fn).toThrow(RangeError)`.

## Approach

The tests follow the rules table: one `describe` per parameter, defaults first. Every number in the rules is tested at the boundary and on both sides of it (`0`, `1`, `100`, `101` for `limit`; `10000` and `10001` for `offset`). Malformed inputs are a table in a loop, so each one is its own named test and a new case is one line. A small `assertRejects` helper checks both the error type and that the message names the parameter, which keeps each test body to one line.
