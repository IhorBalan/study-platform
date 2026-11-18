import type pg from 'pg';
import type Stripe from 'stripe';

/** The fields of a Stripe charge that reconciliation needs. A full Stripe.Charge fits. */
export type StripeCharge = Pick<Stripe.Charge, 'id' | 'amount' | 'amount_refunded' | 'currency' | 'status' | 'payment_intent'>;

export type MismatchField = 'amount' | 'currency' | 'status' | 'refunded';

export interface ReconciliationReport {
  /** Local payments that agree with their succeeded Stripe charge in every field. */
  matched: number;
  /** Succeeded Stripe charges with no local payment for their PaymentIntent. */
  missing: { chargeId: string; paymentIntentId: string | null; amountMinor: number; currency: string }[];
  /** Local payments whose succeeded charge disagrees with them. */
  mismatched: { paymentId: number; paymentIntentId: string; chargeId: string; fields: MismatchField[] }[];
  /** Local payments in the window that claim money but have no succeeded Stripe charge. */
  orphaned: { paymentId: number; paymentIntentId: string | null }[];
  /** Net amounts (amount minus refunds) in minor units, per lower-case currency. */
  totals: Record<string, { stripeNetMinor: number; localNetMinor: number }>;
}

export interface Window {
  from: Date;
  to: Date;
}

/**
 * Compares Stripe's charges for a time window with the local payments table. Stripe is the source of
 * truth for money; the report lists every difference and changes nothing.
 *
 * `charges` can be an array or an async iterable such as `stripe.charges.list({ created: ... })`,
 * which pages through the API as it is consumed.
 *
 * TODO: implement the rules in the task brief.
 */
export async function reconcile(
  pool: pg.Pool,
  charges: Iterable<StripeCharge> | AsyncIterable<StripeCharge>,
  window: Window,
): Promise<ReconciliationReport> {
  void pool;
  void charges;
  void window;
  throw new Error('reconcile is not implemented yet');
}
