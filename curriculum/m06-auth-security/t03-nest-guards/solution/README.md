# Documents API: guards and ownership

A small documents API with three practice users. Login works, and the guards, roles and ownership checks below protect everything else.

| User | Password | Role |
| --- | --- | --- |
| alice | alice-password | member |
| bob | bob-password | member |
| carol | carol-password | admin |

```sh
npm install
npm run build && npm start     # http://127.0.0.1:3000
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/auth/login -H 'content-type: application/json' \
  -d '{"username":"alice","password":"alice-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -i http://127.0.0.1:3000/me -H "authorization: Bearer $TOKEN"
```

## Notes on my solution

A 403 says "this document exists, you just may not see it". With guessable or leaked ids that turns the API into an oracle for which ids are real. A 404 gives a stranger the same answer as for an id that never existed, so the owner and admins are the only ones who learn anything.

The ownership check lives in `DocumentsService` (`findFor`, `listFor`). A guard runs before the handler and only sees the request, so it would have to load the document itself, and a second code path (a queue worker, a GraphQL resolver, a new controller) would skip it. In the service every read and write goes through one rule, and the list query filters by owner instead of loading everything and checking each row. The guards do the coarse work: `AuthGuard` is global and deny-by-default, so a new route is closed until someone marks it `@Public()`, and `RolesGuard` handles "admins only" for whole routes.
