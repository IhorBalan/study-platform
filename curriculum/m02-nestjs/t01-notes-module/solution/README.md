# Notes API

A NestJS 12 app with nothing in it yet. Read the task brief, then build the notes feature in `src/notes/`.

```sh
npm install
npm run build && npm start     # http://127.0.0.1:3000
```

Try it:

```sh
curl -i -X POST http://127.0.0.1:3000/notes -H 'content-type: application/json' -d '{"title":"First"}'
curl -i http://127.0.0.1:3000/notes
```

The project is ESM: relative imports end in `.js` even though the files are `.ts`.
