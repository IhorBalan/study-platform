import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export interface ChargeRequest {
  idempotencyKey: string;
  customerId: string;
  amountCents: number;
}

/** The card gateway. Every call that it has not seen before, by idempotencyKey, is a real charge. */
export interface Gateway {
  charge(request: ChargeRequest): Promise<{ chargeId: string }>;
}

export interface PayInput {
  customerId: string;
  key: string;
  amountCents: number;
}

export interface PayResult {
  paymentId: number;
  chargeId: string;
  amountCents: number;
  replayed: boolean;
}

export interface PaymentsOptions {
  /** How long a started key belongs to the request that started it. */
  leaseMs?: number;
}

/** The key was used before for a different request. */
export class IdempotencyConflictError extends Error {
  override name = 'IdempotencyConflictError';
}

/** Another request with the same key is still running and its lease has not expired. */
export class RequestInProgressError extends Error {
  override name = 'RequestInProgressError';
}

export function createPayments(pool: Pool, gateway: Gateway, options: PaymentsOptions = {}) {
  const leaseMs = options.leaseMs ?? 30_000;
  void leaseMs; // TODO: use it

  async function pay(input: PayInput): Promise<PayResult> {
    // TODO: make this safe to retry. Today every call is a new charge, whatever input.key says.
    const { chargeId } = await gateway.charge({
      idempotencyKey: randomUUID(),
      customerId: input.customerId,
      amountCents: input.amountCents,
    });
    const { rows } = await pool.query<{ id: number }>(
      'insert into payments (customer_id, amount_cents, charge_id) values ($1, $2, $3) returning id',
      [input.customerId, input.amountCents, chargeId],
    );
    return { paymentId: rows[0].id, chargeId, amountCents: input.amountCents, replayed: false };
  }

  return { pay };
}
