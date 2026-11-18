# Notes MCP server

An MCP server over stdio that lets an AI host search a folder of Markdown notes and read them. Read the task brief first.

```sh
npm install
npm run build
mkdir -p ~/mcp-notes && echo "# Deploy checklist" > ~/mcp-notes/deploy.md
NOTES_DIR=~/mcp-notes npx @modelcontextprotocol/inspector node dist/main.js
```

The MCP Inspector opens in the browser, lists your tool and resources and lets you call them by hand.

To use it from Claude Code with your Claude plan:

```sh
claude mcp add --env NOTES_DIR="$HOME/mcp-notes" --transport stdio notes -- node "$PWD/dist/main.js"
```

Then ask Claude Code something like "search my notes for deploy".

## Your notes

Replace this section with a short answer: your notes may contain text written by other people (meeting notes, pasted emails). What could such a note make an AI host do once `search_notes` returns it, and what would you change if the server also had a tool that writes or deletes notes?
