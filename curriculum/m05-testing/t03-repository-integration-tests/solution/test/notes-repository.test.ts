// Integration tests for NotesRepository against a real PostgreSQL.
//
// Isolation: every test runs inside a transaction that is rolled back
// afterwards, so each test starts from whatever the migration left (an empty
// table) and nothing a test writes survives it. The tests therefore pass on
// a dirty database, run after run and in any order.
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { NotesRepository } from '../src/notes-repository.ts';
import { migrate } from '../src/schema.ts';

assert.ok(process.env.DATABASE_URL, 'Set DATABASE_URL to run these tests.');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
let client: pg.PoolClient;
let repo: NotesRepository;

before(async () => {
  await migrate(pool);
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  // Truncate inside the transaction as well: the rollback undoes it, and the
  // test does not see rows that another run committed before this file had
  // isolation.
  await client.query('TRUNCATE notes');
  repo = new NotesRepository(client);
});

afterEach(async () => {
  await client.query('ROLLBACK');
  client.release();
});

/** An id that certainly does not exist: one that was used and deleted. */
async function missingId(): Promise<string> {
  const note = await repo.create({ title: 'temporary' });
  await repo.delete(note.id);
  return note.id;
}

describe('create', () => {
  test('stores the title and body and returns the stored note', async () => {
    const note = await repo.create({ title: 'Buy milk', body: 'Two litres' });
    assert.equal(typeof note.id, 'string');
    assert.equal(note.title, 'Buy milk');
    assert.equal(note.body, 'Two litres');
    assert.ok(note.createdAt instanceof Date);
  });

  test('defaults the body to an empty string', async () => {
    const note = await repo.create({ title: 'No body' });
    assert.equal(note.body, '');
  });
});

describe('findById', () => {
  test('returns the note as it was stored', async () => {
    const created = await repo.create({ title: 'Buy milk', body: 'Two litres' });
    assert.deepEqual(await repo.findById(created.id), created);
  });

  test('returns null for an id that does not exist', async () => {
    assert.equal(await repo.findById(await missingId()), null);
  });
});

describe('listRecent', () => {
  test('returns the newest note first', async () => {
    // Inside one transaction now() is the same for every insert, so this
    // also checks the tie-break on id.
    await repo.create({ title: 'first' });
    await repo.create({ title: 'second' });
    await repo.create({ title: 'third' });
    const titles = (await repo.listRecent(10)).map((n) => n.title);
    assert.deepEqual(titles, ['third', 'second', 'first']);
  });

  test('returns at most `limit` notes', async () => {
    for (const title of ['a', 'b', 'c', 'd']) await repo.create({ title });
    const titles = (await repo.listRecent(2)).map((n) => n.title);
    assert.deepEqual(titles, ['d', 'c']);
  });

  test('returns an empty list when there are no notes', async () => {
    assert.deepEqual(await repo.listRecent(10), []);
  });
});

describe('rename', () => {
  test('changes the title and returns the updated note', async () => {
    const note = await repo.create({ title: 'Old', body: 'kept' });
    const renamed = await repo.rename(note.id, 'New');
    assert.deepEqual(renamed, { ...note, title: 'New' });
    assert.equal((await repo.findById(note.id))?.title, 'New');
  });

  test('leaves other notes untouched', async () => {
    const target = await repo.create({ title: 'target' });
    const other = await repo.create({ title: 'other' });
    await repo.rename(target.id, 'renamed');
    assert.deepEqual(await repo.findById(other.id), other);
  });

  test('returns null for an id that does not exist', async () => {
    assert.equal(await repo.rename(await missingId(), 'New'), null);
  });
});

describe('delete', () => {
  test('removes the note and returns true', async () => {
    const note = await repo.create({ title: 'Doomed' });
    assert.equal(await repo.delete(note.id), true);
    assert.equal(await repo.findById(note.id), null);
  });

  test('returns false when nothing was deleted', async () => {
    assert.equal(await repo.delete(await missingId()), false);
  });

  test('leaves other notes in place', async () => {
    const doomed = await repo.create({ title: 'doomed' });
    const other = await repo.create({ title: 'kept' });
    await repo.delete(doomed.id);
    assert.deepEqual(await repo.findById(other.id), other);
  });
});
