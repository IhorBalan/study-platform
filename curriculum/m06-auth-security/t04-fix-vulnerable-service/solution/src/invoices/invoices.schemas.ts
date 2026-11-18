import { z } from 'zod';

export const CreateInvoiceSchema = z.strictObject({
  customer: z.string().min(1).max(200),
  amountCents: z.int().min(1).max(1_000_000_000),
});
export type CreateInvoice = z.infer<typeof CreateInvoiceSchema>;
