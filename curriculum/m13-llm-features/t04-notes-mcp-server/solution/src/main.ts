#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const notesDir = process.env.NOTES_DIR;
if (!notesDir) {
  // stdout belongs to the protocol. Everything for humans goes to stderr.
  console.error('Set NOTES_DIR to the folder that holds your .md notes.');
  process.exit(1);
}

const server = createServer(notesDir);
await server.connect(new StdioServerTransport());
console.error(`notes MCP server ready, serving ${notesDir}`);
