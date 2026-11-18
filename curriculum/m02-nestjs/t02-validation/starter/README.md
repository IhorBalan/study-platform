# Notes API: validation

The notes API from the previous task, working but trusting. Right now `POST /notes` stores whatever the client sends. Read the task brief, then make the API reject bad input with `400 Bad Request`.

```sh
npm install
npm run build && npm start     # http://127.0.0.1:3000
```

See the problem:

```sh
curl -i -X POST http://127.0.0.1:3000/notes -H 'content-type: application/json' -d '{"title":42,"admin":true}'
```

`class-validator`, `class-transformer` and `zod` are already in `package.json`. Use whichever you prefer.
