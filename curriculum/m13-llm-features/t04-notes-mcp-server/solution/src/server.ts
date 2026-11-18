import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** A note name is the file name without ".md". Nothing else is ever turned into a path. */
const NOTE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_NOTE_BYTES = 64 * 1024;

async function listNoteNames(notesDir: string): Promise<string[]> {
  const entries = await readdir(notesDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name.slice(0, -3))
    .filter((name) => NOTE_NAME.test(name))
    .sort();
}

async function readNote(notesDir: string, name: string): Promise<string | null> {
  if (!NOTE_NAME.test(name)) return null;
  const file = path.join(notesDir, `${name}.md`);
  // Belt and braces: the regex already rules out "/" and "..".
  if (path.dirname(file) !== path.resolve(notesDir)) return null;
  try {
    const text = await readFile(file, 'utf8');
    return text.length > MAX_NOTE_BYTES ? `${text.slice(0, MAX_NOTE_BYTES)}\n[truncated]` : text;
  } catch {
    return null;
  }
}

export function createServer(notesDir: string): McpServer {
  const dir = path.resolve(notesDir);
  const server = new McpServer({ name: 'notes', version: '1.0.0' });

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description: 'Find notes whose name or text contains the query (case-insensitive). Returns names and a short snippet.',
      inputSchema: {
        query: z.string().trim().min(1).max(100),
        limit: z.number().int().min(1).max(10).default(5),
      },
      outputSchema: {
        results: z.array(z.object({ name: z.string(), snippet: z.string() })),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      const needle = query.toLowerCase();
      const results: { name: string; snippet: string }[] = [];
      for (const name of await listNoteNames(dir)) {
        const text = (await readNote(dir, name)) ?? '';
        const at = text.toLowerCase().indexOf(needle);
        if (at === -1 && !name.includes(needle)) continue;
        const start = Math.max(0, at - 40);
        results.push({ name, snippet: (at === -1 ? text.slice(0, 80) : text.slice(start, at + needle.length + 40)).replace(/\s+/g, ' ').trim() });
        if (results.length >= limit) break;
      }
      const summary = results.length
        ? results.map((r) => `- ${r.name}: ${r.snippet}`).join('\n')
        : `No notes match "${query}".`;
      return { content: [{ type: 'text', text: summary }], structuredContent: { results } };
    },
  );

  server.registerResource(
    'note',
    new ResourceTemplate('note://{name}', {
      list: async () => ({
        resources: (await listNoteNames(dir)).map((name) => ({ uri: `note://${name}`, name, mimeType: 'text/markdown' })),
      }),
    }),
    { title: 'Note', description: 'One Markdown note', mimeType: 'text/markdown' },
    async (uri, { name }) => {
      const text = typeof name === 'string' ? await readNote(dir, name) : null;
      if (text === null) throw new Error(`Note not found: ${uri.href}`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );

  return server;
}
