// Test helpers: a pool on DATABASE_URL, a schema reset, the fixture charges and a payment seeder.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { StripeCharge } from '../reconcile.js';

export function testPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL, for example postgres://lab:lab@localhost:55432/lab');
  return new pg.Pool({ connectionString, max: 5 });
}

/** Drops and recreates the tables from db/schema.sql. Run from the project root (npm test does). */
export async function resetSchema(pool: pg.Pool): Promise<void> {
  await pool.query(readFileSync('db/schema.sql', 'utf8'));
}

export function fixtureCharges(): StripeCharge[] {
  return JSON.parse(readFileSync('fixtures/charges.json', 'utf8')) as StripeCharge[];
}

export const WINDOW = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') };

export interface SeedPayment {
  orderId?: string;
  pi: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'failed' | 'succeeded' | 'partially_refunded' | 'refunded';
  refunded?: number;
  createdAt?: string;
}

/** Inserts payments and returns their ids in the same order. */
export async function seed(pool: pg.Pool, payments: SeedPayment[]): Promise<number[]> {
  const ids: number[] = [];
  for (const [i, p] of payments.entries()) {
    const { rows } = await pool.query(
      `insert into payments (order_id, stripe_payment_intent_id, amount_minor, currency, status, refunded_minor, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [p.orderId ?? `ord_${i + 1}`, p.pi, p.amount, p.currency, p.status, p.refunded ?? 0, p.createdAt ?? '2026-11-01T12:00:00Z'],
    );
    ids.push(rows[0].id);
  }
  return ids;
}
