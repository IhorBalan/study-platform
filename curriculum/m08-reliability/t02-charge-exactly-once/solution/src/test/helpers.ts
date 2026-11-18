// Test helpers: a pool on DATABASE_URL, a schema reset and a fake gateway.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { ChargeRequest, Gateway } from '../payments.js';

export function testPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL, for example postgres://lab:lab@localhost:55432/lab');
  return new pg.Pool({ connectionString, max: 10 });
}

/** Drops and recreates the tables from db/schema.sql. Run from the project root (npm test does). */
export async function resetSchema(pool: pg.Pool): Promise<void> {
  await pool.query(readFileSync('db/schema.sql', 'utf8'));
}

/** A gateway that deduplicates by idempotencyKey, like a real one, and counts real charges. */
export class FakeGateway implements Gateway {
  readonly calls: ChargeRequest[] = [];
  private readonly charges = new Map<string, string>();
  constructor(private readonly delayMs = 0) {}

  get realCharges(): number {
    return this.charges.size;
  }

  async charge(request: ChargeRequest): Promise<{ chargeId: string }> {
    this.calls.push(request);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    let chargeId = this.charges.get(request.idempotencyKey);
    if (!chargeId) {
      chargeId = `ch_${this.charges.size + 1}`;
      this.charges.set(request.idempotencyKey, chargeId);
    }
    return { chargeId };
  }
}
