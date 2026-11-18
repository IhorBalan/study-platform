import { z } from 'zod';

// TODO: enforce the rules from the brief (a string of 1 to 4000 characters).
export const ChatRequestSchema = z.object({
  message: z.string(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** The events this endpoint sends. The browser only ever sees these shapes. */
export type ChatEvent =
  | { type: 'delta'; data: { text: string } }
  | { type: 'done'; data: { finishReason: string; usage: { inputTokens: number | null; outputTokens: number | null } } }
  | { type: 'error'; data: { code: 'rate_limited' | 'upstream_error' | 'timeout' } };
