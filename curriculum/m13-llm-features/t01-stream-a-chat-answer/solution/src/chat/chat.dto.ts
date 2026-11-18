import { z } from 'zod';

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** The events this endpoint sends. The browser only ever sees these shapes. */
export type ChatEvent =
  | { type: 'delta'; data: { text: string } }
  | { type: 'done'; data: { finishReason: string; usage: { inputTokens: number | null; outputTokens: number | null } } }
  | { type: 'error'; data: { code: 'rate_limited' | 'upstream_error' | 'timeout' } };
