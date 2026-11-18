import { z } from 'zod';

/** The position after which the next page starts: the sort key of the last item sent. */
export interface Cursor {
  createdAt: string;
  id: string;
}

const CursorSchema = z.strictObject({ c: z.iso.datetime(), i: z.string().min(1) });

// base64url of a small JSON object. Opaque to clients: they pass it back
// unchanged and never build one, so the format can change without breaking them.
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt, i: cursor.id })).toString('base64url');
}

/** Returns undefined for anything that is not a cursor this server issued. */
export function decodeCursor(raw: string): Cursor | undefined {
  try {
    const parsed = CursorSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return parsed.success ? { createdAt: parsed.data.c, id: parsed.data.i } : undefined;
  } catch {
    return undefined;
  }
}
