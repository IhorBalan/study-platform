import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { tx } from './db.js';

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

type Stored = Omit<PayResult, 'replayed'>;

const fingerprint = (input: PayInput) => createHash('sha256').update(JSON.stringify([input.amountCents])).digest('hex');

/** The same customer and key always give the gateway the same key, so a repeated charge is deduplicated there. */
const gatewayKey = (input: PayInput) => `pay:${input.customerId}:${input.key}`;

export function createPayments(pool: Pool, gateway: Gateway, options: PaymentsOptions = {}) {
  const leaseMs = options.leaseMs ?? 30_000;

  /**
   * Phase 1: own the key. Returns a stored result to replay, or null when this request now owns the key.
   * Insert-or-nothing and the takeover are each one statement, so two requests can never both own a key.
   */
  async function claim(input: PayInput, hash: string): Promise<Stored | null> {
    const inserted = await pool.query(
      `insert into idempotency_keys (customer_id, key, request_hash, locked_until)
       values ($1, $2, $3, now() + make_interval(secs => $4::float8 / 1000))
       on conflict do nothing
       returning key`,
      [input.customerId, input.key, hash, leaseMs],
    );
    if (inserted.rowCount === 1) return null;

    const { rows } = await pool.query<{ request_hash: string; status: string; response: Stored | null }>(
      'select request_hash, status, response from idempotency_keys where customer_id = $1 and key = $2',
      [input.customerId, input.key],
    );
    const existing = rows[0];
    if (!existing) return claim(input, hash); // released between our insert and select: try again
    if (existing.request_hash !== hash) {
      throw new IdempotencyConflictError(`Key ${input.key} was already used for a different payment`);
    }
    if (existing.status === 'done' && existing.response) return existing.response;

    // Started by someone else. Take it over only if their lease has expired.
    const taken = await pool.query(
      `update idempotency_keys
          set locked_until = now() + make_interval(secs => $3::float8 / 1000)
        where customer_id = $1 and key = $2 and status = 'started' and locked_until < now()
        returning key`,
      [input.customerId, input.key, leaseMs],
    );
    if (taken.rowCount === 1) return null;
    throw new RequestInProgressError(`A payment with key ${input.key} is still in progress`);
  }

  async function pay(input: PayInput): Promise<PayResult> {
    const hash = fingerprint(input);
    const stored = await claim(input, hash);
    if (stored) return { ...stored, replayed: true };

    // Phase 2: the external call, outside any transaction. If it fails, the outcome is unknown,
    // so the key stays started; a retry after the lease repeats the call with the same gateway key.
    const { chargeId } = await gateway.charge({
      idempotencyKey: gatewayKey(input),
      customerId: input.customerId,
      amountCents: input.amountCents,
    });

    // Phase 3: the payment row and the stored response commit together.
    const result = await tx(pool, async (client) => {
      const { rows } = await client.query<{ id: number }>(
        'insert into payments (customer_id, amount_cents, charge_id) values ($1, $2, $3) returning id',
        [input.customerId, input.amountCents, chargeId],
      );
      const response: Stored = { paymentId: rows[0].id, chargeId, amountCents: input.amountCents };
      await client.query(
        `update idempotency_keys set status = 'done', response = $3, locked_until = null
          where customer_id = $1 and key = $2`,
        [input.customerId, input.key, JSON.stringify(response)],
      );
      return response;
    });
    return { ...result, replayed: false };
  }

  return { pay };
}
