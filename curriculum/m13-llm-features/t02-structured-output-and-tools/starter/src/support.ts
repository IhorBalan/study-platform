import type { LanguageModel } from 'ai';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Part 1: structured triage with one repair attempt
// ---------------------------------------------------------------------------

// TODO: tighten this schema to the rules in the brief (enums, length limits, order id format,
// nullable orderId, no unknown keys).
export const TriageSchema = z.object({
  category: z.string(),
  priority: z.string(),
  summary: z.string(),
  orderId: z.string().nullable(),
});
export type Triage = z.infer<typeof TriageSchema>;

export class TriageFailedError extends Error {
  constructor(
    readonly attempts: number,
    options?: { cause?: unknown },
  ) {
    super(`The model returned invalid triage output ${attempts} times`, options);
    this.name = 'TriageFailedError';
  }
}

export async function triageTicket(
  model: LanguageModel,
  ticket: string,
): Promise<{ triage: Triage; attempts: number }> {
  // TODO: generateText with instructions, the ticket as a user message and Output.object({ schema }).
  // On NoObjectGeneratedError, make one repair call; after a second failure throw TriageFailedError.
  void model;
  void ticket;
  throw new Error('Not implemented');
}

// ---------------------------------------------------------------------------
// Part 2: a tool loop with a step cap and authorisation in code
// ---------------------------------------------------------------------------

export interface Order {
  id: string;
  customerId: string;
  status: 'paid' | 'shipped' | 'delivered' | 'refunded';
  totalCents: number;
  /** Free text the customer typed at checkout. Untrusted. */
  note: string;
}

export interface SupportDeps {
  /** The signed-in customer. Every tool acts on their behalf only. */
  customerId: string;
  getOrder(orderId: string): Promise<Order | null>;
  refund(orderId: string, amountCents: number): Promise<{ refundId: string }>;
}

export class StepLimitError extends Error {
  constructor(readonly steps: number) {
    super(`The assistant did not finish within ${steps} steps`);
    this.name = 'StepLimitError';
  }
}

export async function runSupportAgent(
  model: LanguageModel,
  question: string,
  deps: SupportDeps,
  options: { maxSteps?: number } = {},
): Promise<{ text: string; steps: number; refunds: string[] }> {
  // TODO: generateText with the tools getOrder and refundOrder and stopWhen: isStepCount(maxSteps).
  void model;
  void question;
  void deps;
  void options;
  throw new Error('Not implemented');
}
