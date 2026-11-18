// Test helpers: a pool on DATABASE_URL, a schema reset and a publisher that records what it sends.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Message } from '../messages.js';

export function testPool(max = 10): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL, for example postgres://lab:lab@localhost:55432/lab');
  return new pg.Pool({ connectionString, max });
}

/** Drops and recreates the tables from db/schema.sql. Run from the project root (npm test does). */
export async function resetSchema(pool: pg.Pool): Promise<void> {
  await pool.query(readFileSync('db/schema.sql', 'utf8'));
}

/** A publish() that records every message it accepted. Set failNext to make the next call throw. */
export function recordingPublisher() {
  const sent: Message[] = [];
  const control = { failNext: 0 };
  async function publish(message: Message): Promise<void> {
    if (control.failNext > 0) {
      control.failNext--;
      throw new Error('broker unavailable');
    }
    sent.push(message);
  }
  return { sent, control, publish };
}
