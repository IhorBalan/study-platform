import { z } from 'zod';

export const CreatePaymentSchema = z.strictObject({
  /** In minor units: 1999 is 19.99. */
  amount: z.int().min(1).max(1_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().max(200).optional(),
});
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;

export interface Payment {
  id: string;
  amount: number;
  currency: string;
  description: string | null;
  status: 'succeeded';
  chargeId: string;
  createdAt: string;
}
