// Runs reconciliation for the fixture charges and prints the report. Usage: npm run reconcile
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { reconcile, type StripeCharge } from './reconcile.js';

const charges = JSON.parse(readFileSync('fixtures/charges.json', 'utf8')) as StripeCharge[];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const report = await reconcile(pool, charges, { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
