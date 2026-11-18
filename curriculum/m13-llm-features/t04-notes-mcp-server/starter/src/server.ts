import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Builds the notes MCP server. A note is a file `<name>.md` directly inside notesDir.
 */
export function createServer(notesDir: string): McpServer {
  const server = new McpServer({ name: 'notes', version: '1.0.0' });

  // TODO: register the tool `search_notes` with server.registerTool(name, config, handler).
  //   config: description, inputSchema (a zod shape), outputSchema, annotations
  //   handler: returns { content: [{ type: 'text', text }], structuredContent: { results } }

  // TODO: register the resource template `note://{name}` with server.registerResource()
  //   and a ResourceTemplate whose `list` callback enumerates the notes.
  //   Turn a name into a file path only after checking it against a strict pattern.

  void notesDir;
  return server;
}
