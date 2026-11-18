import { z } from 'zod';

export interface Note {
  id: string;
  title: string;
  body: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * The only shape POST /notes accepts. `strictObject` rejects unknown keys
 * instead of dropping them, so a client that misspells a field finds out.
 */
export const CreateNoteSchema = z.strictObject({
  title: z.string().min(1).max(100),
  body: z.string().max(2000).optional(),
});

// The static type is derived from the schema, so the two cannot drift apart.
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;
