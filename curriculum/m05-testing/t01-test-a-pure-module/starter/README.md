# Page params: tests

`src/page-params.ts` parses `limit`, `offset` and `sort` from a list endpoint's query string. It is correct. Your job is to write the tests in `test/page-params.test.ts` that would catch it if someone broke it.

Node runs TypeScript test files directly by stripping the types, so you need no install to run the tests:

```sh
npm test
```

`npm install` is only for editor types and `npm run typecheck`.

The tests use Node's built-in runner (`node:test` and `node:assert/strict`). Everything you write maps one-to-one to Vitest: `describe` and `test` are the same, `assert.equal(a, b)` is `expect(a).toBe(b)`, `assert.deepEqual` is `toEqual`, and `assert.throws(fn, RangeError)` is `expect(fn).toThrow(RangeError)`.
