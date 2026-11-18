`src/page-params.ts` turns the query string of a list endpoint into `{ limit, offset, sort }`. The code is correct. Write the tests that would catch it the day someone breaks it.

## The rules

`parsePageParams(query)` takes a `Record<string, string | undefined>` and returns `{ limit, offset, sort: { field, direction } }`. A parameter that is missing or an empty string counts as absent. Other keys are ignored.

| Parameter | Rule |
| --- | --- |
| `limit` | Absent: `20`. Otherwise digits only (no sign, no spaces, no decimal point, no exponent). `0` is rejected. Values above `100` become `100`; they are not rejected. |
| `offset` | Absent: `0`. Otherwise digits only. `0` to `10000` inclusive; above `10000` is rejected. |
| `sort` | Absent: `{ field: 'createdAt', direction: 'desc' }`. Otherwise `createdAt` or `title`, optionally with a leading `-`. Without `-` the direction is `asc`, also for `createdAt`. Any other value is rejected. |

A rejected value throws a `RangeError` whose message contains the parameter's name (`limit`, `offset` or `sort`).

## Requirements

- Write your tests in `test/page-params.test.ts`. More `test/*.test.ts` files are fine.
- Use `node:test` and `node:assert/strict`. Node runs `.ts` files directly; `npm test` needs no install.
- Import the module as `../src/page-params.ts`. Do not change `src/page-params.ts`.
- The tests must not depend on anything outside the folder.

Vitest is what you would use at work; the lesson on unit tests maps every call you need. The checks use `node:test` because it ships with Node and the sandbox has no internet.

## Submission

The folder with `src/`, `test/` and `package.json`, without `node_modules`.

## What is checked

The checks copy your `test/` folder next to a fresh copy of the correct implementation and run it: every test must pass. Then they run it against broken copies of the module, each with one realistic bug (a wrong default, an off-by-one at a boundary, a lax number parser, a wrong sort direction, a wrong error type). Your tests must fail for every broken copy. When one survives, the result names the bug, not the test you need. The review looks at test names, boundaries and structure.
