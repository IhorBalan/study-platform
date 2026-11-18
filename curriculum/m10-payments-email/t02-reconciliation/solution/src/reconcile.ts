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

interface LocalPayment {
  id: number;
  paymentIntentId: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  refundedMinor: number;
}

const CLAIMS_MONEY = new Set(['succeeded', 'partially_refunded', 'refunded']);

/** pg returns bigint as a string. Convert once, and refuse anything a JS number cannot hold exactly. */
function toMinor(value: string | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`not a safe integer amount: ${value}`);
  return n;
}

const piId = (pi: StripeCharge['payment_intent']): string | null => (typeof pi === 'string' ? pi : (pi?.id ?? null));

/** What the local status should be, given what Stripe says about refunds. */
function expectedStatus(charge: StripeCharge): string {
  if (charge.amount_refunded === 0) return 'succeeded';
  return charge.amount_refunded >= charge.amount ? 'refunded' : 'partially_refunded';
}

function row(r: Record<string, unknown>): LocalPayment {
  return {
    id: Number(r.id),
    paymentIntentId: (r.stripe_payment_intent_id as string | null) ?? null,
    amountMinor: toMinor(r.amount_minor as string),
    currency: String(r.currency).toLowerCase(),
    status: String(r.status),
    refundedMinor: toMinor(r.refunded_minor as string),
  };
}

/**
 * Compares Stripe's charges for a time window with the local payments table. Stripe is the source of
 * truth for money; the report lists every difference and changes nothing.
 *
 * `charges` can be an array or an async iterable such as `stripe.charges.list({ created: ... })`,
 * which pages through the API as it is consumed.
 */
export async function reconcile(
  pool: pg.Pool,
  charges: Iterable<StripeCharge> | AsyncIterable<StripeCharge>,
  window: Window,
): Promise<ReconciliationReport> {
  // 1. Stripe's side: only succeeded charges moved money. Earlier failed attempts on the same intent are noise.
  const succeeded: StripeCharge[] = [];
  for await (const charge of charges) {
    if (charge.status === 'succeeded') succeeded.push(charge);
  }

  // 2. Local side: payments created in the window, plus any payment a charge points to (window edges drift).
  const intentIds = succeeded.map((c) => piId(c.payment_intent)).filter((id): id is string => id !== null);
  const { rows } = await pool.query(
    `select id, stripe_payment_intent_id, amount_minor, currency, status, refunded_minor
       from payments
      where (created_at >= $1 and created_at < $2)
         or stripe_payment_intent_id = any($3::text[])`,
    [window.from, window.to, intentIds],
  );
  const local = rows.map(row);
  const byIntent = new Map(local.filter((p) => p.paymentIntentId).map((p) => [p.paymentIntentId!, p]));

  const report: ReconciliationReport = { matched: 0, missing: [], mismatched: [], orphaned: [], totals: {} };
  const total = (currency: string) => (report.totals[currency] ??= { stripeNetMinor: 0, localNetMinor: 0 });
  const matchedIds = new Set<number>();

  // 3. Match every succeeded charge.
  for (const charge of succeeded) {
    const currency = charge.currency.toLowerCase();
    total(currency).stripeNetMinor += charge.amount - charge.amount_refunded;

    const intent = piId(charge.payment_intent);
    const payment = intent ? byIntent.get(intent) : undefined;
    if (!payment) {
      report.missing.push({ chargeId: charge.id, paymentIntentId: intent, amountMinor: charge.amount, currency });
      continue;
    }
    matchedIds.add(payment.id);

    const fields: MismatchField[] = [];
    if (payment.amountMinor !== charge.amount) fields.push('amount');
    if (payment.currency !== currency) fields.push('currency');
    if (payment.status !== expectedStatus(charge)) fields.push('status');
    if (payment.refundedMinor !== charge.amount_refunded) fields.push('refunded');
    if (fields.length === 0) report.matched += 1;
    else report.mismatched.push({ paymentId: payment.id, paymentIntentId: intent!, chargeId: charge.id, fields });
  }

  // 4. Local payments that claim money: count them, and report those Stripe knows nothing about.
  for (const payment of local) {
    if (!CLAIMS_MONEY.has(payment.status)) continue;
    total(payment.currency).localNetMinor += payment.amountMinor - payment.refundedMinor;
    if (!matchedIds.has(payment.id)) report.orphaned.push({ paymentId: payment.id, paymentIntentId: payment.paymentIntentId });
  }

  report.missing.sort((a, b) => a.chargeId.localeCompare(b.chargeId));
  report.mismatched.sort((a, b) => a.paymentId - b.paymentId);
  report.orphaned.sort((a, b) => a.paymentId - b.paymentId);
  return report;
}
