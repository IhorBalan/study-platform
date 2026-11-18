import type { Queryable } from './notes-repository.ts';

/** Creates the notes table. Safe to run more than once. */
export async function migrate(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      body       text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
