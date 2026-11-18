import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { NotesRepository } from '../src/notes-repository.ts';
import { migrate } from '../src/schema.ts';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const repo = new NotesRepository(pool);

before(async () => {
  await migrate(pool);
});

after(async () => {
  await pool.end();
});

// This test passes on an empty database and fails on the second run.
// Run `npm test` twice and see. Then give every test a clean slate.
test('lists a created note', async () => {
  await repo.create({ title: 'Buy milk' });
  const notes = await repo.listRecent(10);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, 'Buy milk');
});

// TODO: create, findById (found and missing), listRecent (order and limit),
// rename (found, missing, and that other notes are untouched), delete (found and missing).
