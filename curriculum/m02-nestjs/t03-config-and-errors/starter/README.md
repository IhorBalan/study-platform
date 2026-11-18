# Notes API: configuration and errors

The validated notes API from the previous task. Two things are missing: it reads `process.env` wherever it likes without checking it, and its errors use Nest's default JSON shape. Read the task brief, then fix both.

```sh
npm install
cp .env.example .env
npm run build && node --env-file=.env dist/main.js     # http://127.0.0.1:3000
```

See the problems:

```sh
curl -i http://127.0.0.1:3000/debug/boom
PORT=abc node dist/main.js
```

`GET /debug/boom` exists so that you, and the checks, can watch an unexpected error travel through the app. Leave `src/debug/debug.controller.ts` as it is.
