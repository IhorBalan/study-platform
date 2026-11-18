// Test helpers: a pool on DATABASE_URL, a schema reset and transports that never touch the network.
import { readFileSync } from 'node:fs';
import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer';
import pg from 'pg';

export function testPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL, for example postgres://lab:lab@localhost:55432/lab');
  return new pg.Pool({ connectionString, max: 10 });
}

/** Drops and recreates the tables from db/schema.sql. Run from the project root (npm test does). */
export async function resetSchema(pool: pg.Pool): Promise<void> {
  await pool.query(readFileSync('db/schema.sql', 'utf8'));
}

/** A transport that records every message instead of sending it (nodemailer's jsonTransport). */
export function recordingTransport(): { transport: Transporter; sent: SendMailOptions[] } {
  const sent: SendMailOptions[] = [];
  const inner = nodemailer.createTransport({ jsonTransport: true });
  const transport = {
    sendMail: async (mail: SendMailOptions) => {
      await new Promise((resolve) => setTimeout(resolve, 20)); // like a real server, not instant
      sent.push(mail);
      return inner.sendMail(mail);
    },
  } as unknown as Transporter;
  return { transport, sent };
}

/** A transport whose every send fails, like an SMTP server that is down. */
export function failingTransport(): Transporter {
  return {
    sendMail: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  } as unknown as Transporter;
}
