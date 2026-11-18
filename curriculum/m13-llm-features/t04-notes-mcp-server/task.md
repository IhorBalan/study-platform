Give an AI host, such as Claude Code, access to a folder of Markdown notes through the Model Context Protocol: one tool to search them and one resource template to read them, without ever serving a file from outside the folder.

## Requirements

Use `@modelcontextprotocol/sdk` (version 1, already in `package.json`) and zod. Keep `src/server.ts` exporting `createServer(notesDir)` and `src/main.ts` as the entry point that reads the folder from the `NOTES_DIR` environment variable and connects over stdio. The server's name is `notes`.

A **note** is a file `<name>.md` directly inside `NOTES_DIR`, where the name consists of lowercase letters, digits and hyphens. Other files are not notes.

**Tool `search_notes`**

- Input: `query`, a string of 1 to 100 characters (required); `limit`, an integer from 1 to 10 (optional, default 5).
- Finds notes whose name or text contains the query, ignoring case, and returns at most `limit` of them.
- Result: `structuredContent: { results: [{ name, snippet }] }`, where `snippet` is a short piece of the note around the match, and a text summary of the same results in `content`. No matches is a normal result with `results: []`.
- Has a description that tells a model when to use it, and the annotation `readOnlyHint: true`.
- Invalid arguments are rejected without running the search.

**Resource template `note://{name}`**

- Listing resources returns one `note://<name>` entry per note.
- Reading `note://<name>` returns the note's text, with the requested `uri` in the content.
- A name that is not a note, including any attempt to reach a file outside `NOTES_DIR`, fails without revealing anything, and the server keeps running.

Nothing but protocol messages may be written to stdout.

## Submission

`src/`, `package.json`, `tsconfig.json` and `README.md` with its question answered.

## What is checked

The checks compile the project, create a notes folder next to files that must stay private, start `node dist/main.js` with the MCP SDK's own client over stdio, and then list and call the tool with valid and invalid arguments, list and read resources, and try to read outside the folder with plain and URL-encoded `..` sequences and absolute paths. The review looks at how names become paths and at your README answer.
