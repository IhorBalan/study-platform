import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            serial PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    name          text NOT NULL,
    password_hash text NOT NULL,
    role          text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    created_at    timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id           serial PRIMARY KEY,
    owner_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer     text NOT NULL,
    amount_cents integer NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
  );
`;

/** One pool for the app. Reads DATABASE_URL and creates the tables on start. */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly pool: pg.Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set. Start the lab database with `pnpm lab up postgres`.');
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /** Runs one statement. Values go in `params` as $1, $2, ...; never into `text`. */
  async query<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }
}
