# Documents API: guards and ownership

A small documents API with three practice users. Login works; nothing else is protected yet.

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

TODO: why does a member who asks for someone else's document get 404 and not 403?

TODO: where does your ownership check live, and why there and not in a guard?
