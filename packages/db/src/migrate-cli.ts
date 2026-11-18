import { createDatabase } from './client.js';
import { runMigrations } from './migrate.js';

const url = process.env.DATABASE_URL ?? 'postgres://study:study@localhost:54320/study';
const { db, pool } = createDatabase(url);
try {
  await runMigrations(db);
  console.log('Migrations applied.');
} finally {
  await pool.end();
}
