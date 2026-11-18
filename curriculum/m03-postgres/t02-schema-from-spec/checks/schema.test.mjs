// Checks for "Design a schema from a spec". Node built-ins only; `pg` comes from the submission.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const TABLES = ['users', 'teams', 'memberships', 'tasks'];
const state = { client: null, setupError: null, applyError: null };

async function loadPg() {
  const require = createRequire(path.join(dir, 'package.json'));
  const mod = await import(require.resolve('pg'));
  return mod.default ?? mod;
}

/** Drops and recreates the `design` schema, then runs schema.sql in it. Returns an error message or null. */
async function applySchema() {
  const { client } = state;
  await client.query('drop schema if exists design cascade; create schema design; set search_path to design, public');
  const file = path.join(dir, 'schema.sql');
  if (!existsSync(file)) return 'schema.sql is missing from the submission.';
  try {
    await client.query(readFileSync(file, 'utf8'));
  } catch (error) {
    return `schema.sql failed: ${error.message}`;
  }
  const { rows } = await client.query(
    `select table_name from information_schema.tables where table_schema = 'design' and table_type = 'BASE TABLE'`,
  );
  const found = new Set(rows.map((r) => r.table_name));
  const missing = TABLES.filter((t) => !found.has(t));
  if (missing.length) return `schema.sql ran, but these tables were not created: ${missing.join(', ')}.`;
  return null;
}

before(async () => {
  if (!process.env.DATABASE_URL) {
    state.setupError = 'DATABASE_URL is not set. Start the lab database with `pnpm lab up postgres`.';
    return;
  }
  try {
    const pg = await loadPg();
    state.client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await state.client.connect();
    await state.client.query(`set statement_timeout = '5s'`);
    state.applyError = await applySchema();
  } catch (error) {
    state.setupError = `Could not prepare the database: ${error.message}`;
  }
});

after(async () => {
  await state.client?.end();
});

function ready() {
  assert.ok(!state.setupError, state.setupError);
  assert.ok(!state.applyError, `The schema did not apply, fix the "applies" criterion first. ${state.applyError}`);
}

/** Each test starts from empty tables so that tests do not depend on each other. */
async function fresh() {
  ready();
  await state.client.query(`truncate ${TABLES.join(', ')} restart identity cascade`);
}

const q = (sql, params) => state.client.query(sql, params);

async function insert(table, values) {
  const cols = Object.keys(values);
  const sql = `insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`;
  const { rows } = await q(sql, Object.values(values));
  return rows[0];
}

async function expectInsertOk(table, values, what) {
  try {
    return await insert(table, values);
  } catch (error) {
    assert.fail(`${what}: expected the insert into ${table} to succeed, but it failed with ${error.code}: ${error.message}`);
  }
}

/**
 * Expects a rejected statement. `codes` lists acceptable SQLSTATE codes or classes ('22' matches any 22xxx).
 * An undefined column or table (class 42) means the schema does not follow the spec, so it is reported as such.
 */
async function expectRejected(run, what, codes) {
  let error;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert.ok(error, `${what}: expected the database to reject this, but it was accepted.`);
  assert.ok(
    !String(error.code).startsWith('42'),
    `${what}: the statement failed for the wrong reason (${error.code}: ${error.message}). Check the table and column names in the spec.`,
  );
  const ok = codes.some((c) => String(error.code).startsWith(c));
  assert.ok(ok, `${what}: rejected with ${error.code} (${error.message}), expected one of ${codes.join(', ')}.`);
}

const NOT_NULL = ['23502'];
const RULE = ['23514', '22']; // a CHECK constraint, or a data error from an enum, domain or varchar limit
const UNIQUE = ['23505'];
const FK = ['23503'];

async function seedBasics() {
  const ada = await insert('users', { email: 'ada@example.com', display_name: 'Ada' });
  const bob = await insert('users', { email: 'bob@example.com', display_name: 'Bob' });
  const core = await insert('teams', { name: 'Core' });
  const web = await insert('teams', { name: 'Web' });
  await insert('memberships', { team_id: core.id, user_id: ada.id, role: 'owner' });
  await insert('memberships', { team_id: core.id, user_id: bob.id });
  await insert('memberships', { team_id: web.id, user_id: bob.id });
  return { ada, bob, core, web };
}

test('applies: schema.sql runs on an empty database and creates the four tables', () => {
  assert.ok(!state.setupError, state.setupError);
  assert.ok(!state.applyError, state.applyError);
});

test('accepts-valid: valid rows are accepted and defaults are filled in', async () => {
  await fresh();
  const ada = await expectInsertOk('users', { email: 'ada@example.com', display_name: 'Ada' }, 'A new user');
  assert.ok(ada.id !== null && ada.id !== undefined, 'users.id should be generated by the database.');
  assert.ok(ada.created_at instanceof Date, 'users.created_at should default to the current time.');
  const team = await expectInsertOk('teams', { name: 'Core' }, 'A new team');
  assert.ok(team.created_at instanceof Date, 'teams.created_at should default to the current time.');
  const m = await expectInsertOk('memberships', { team_id: team.id, user_id: ada.id }, 'A membership without a role');
  assert.equal(m.role, 'member', `memberships.role should default to 'member', got ${JSON.stringify(m.role)}.`);
  assert.ok(m.joined_at instanceof Date, 'memberships.joined_at should default to the current time.');

  const minimal = await expectInsertOk('tasks', { team_id: team.id, title: 'Write the spec' }, 'A task with only a team and title');
  assert.equal(minimal.status, 'todo', `tasks.status should default to 'todo', got ${JSON.stringify(minimal.status)}.`);
  assert.equal(minimal.assignee_id, null, 'A task without an assignee should have assignee_id NULL.');
  assert.ok(minimal.created_at instanceof Date, 'tasks.created_at should default to the current time.');

  await expectInsertOk(
    'tasks',
    {
      team_id: team.id,
      title: 'x'.repeat(200),
      status: 'done',
      assignee_id: ada.id,
      estimate_hours: 1.5,
      due_on: '2026-12-01',
      completed_at: new Date(),
    },
    'A done task with every optional field and a 200-character title',
  );
  await expectInsertOk('tasks', { team_id: team.id, title: 'In progress', status: 'doing' }, 'A task in status doing');
  await expectInsertOk('memberships', { team_id: team.id, user_id: (await insert('users', { email: 'o@example.com', display_name: 'O' })).id, role: 'owner' }, 'An owner membership');
});

test('required-fields: required columns reject NULL', async () => {
  await fresh();
  const { core } = await seedBasics();
  await expectRejected(() => insert('users', { display_name: 'No email' }), 'A user without an email', NOT_NULL);
  await expectRejected(() => insert('users', { email: 'x@example.com' }), 'A user without a display_name', NOT_NULL);
  await expectRejected(() => insert('teams', { name: null }), 'A team without a name', NOT_NULL);
  await expectRejected(() => insert('tasks', { team_id: core.id }), 'A task without a title', NOT_NULL);
  await expectRejected(() => insert('tasks', { title: 'Orphan' }), 'A task without a team_id', NOT_NULL);
  await expectRejected(
    () => insert('tasks', { team_id: core.id, title: 'Null status', status: null }),
    'A task with status NULL',
    NOT_NULL,
  );
});

test('value-rules: values outside the allowed range are rejected', async () => {
  await fresh();
  const { core, ada } = await seedBasics();
  const task = (extra) => () => insert('tasks', { team_id: core.id, title: 'T', ...extra });
  await expectRejected(task({ title: '' }), 'A task with an empty title', RULE);
  await expectRejected(task({ title: 'x'.repeat(201) }), 'A task with a 201-character title', RULE);
  await expectRejected(task({ status: 'blocked' }), "A task with status 'blocked'", RULE);
  await expectRejected(task({ estimate_hours: 0 }), 'A task with estimate_hours 0', RULE);
  await expectRejected(task({ estimate_hours: -2 }), 'A task with a negative estimate_hours', RULE);
  await expectRejected(task({ status: 'done' }), 'A done task without completed_at', RULE);
  await expectRejected(task({ status: 'todo', completed_at: new Date() }), 'A todo task with completed_at set', RULE);
  await expectRejected(
    () => insert('users', { email: 'empty@example.com', display_name: '' }),
    'A user with an empty display_name',
    RULE,
  );
  const w = await insert('users', { email: 'w@example.com', display_name: 'W' });
  await expectRejected(
    () => insert('memberships', { team_id: core.id, user_id: w.id, role: 'admin' }),
    "A membership with role 'admin'",
    RULE,
  );
  // Updates are checked too, not only inserts.
  const t = await insert('tasks', { team_id: core.id, title: 'Finish me', assignee_id: ada.id });
  await expectRejected(
    () => q(`update tasks set status = 'done' where id = $1`, [t.id]),
    'Setting status to done without completed_at',
    RULE,
  );
});

test('unique-rules: duplicates are rejected', async () => {
  await fresh();
  const { core, ada } = await seedBasics();
  await expectRejected(
    () => insert('users', { email: 'ada@example.com', display_name: 'Ada again' }),
    'A second user with the same email',
    UNIQUE,
  );
  await expectRejected(
    () => insert('users', { email: 'ADA@Example.com', display_name: 'Ada shouting' }),
    'A second user whose email differs only in case',
    UNIQUE,
  );
  await expectRejected(() => insert('teams', { name: 'Core' }), 'A second team named Core', UNIQUE);
  await expectRejected(
    () => insert('memberships', { team_id: core.id, user_id: ada.id }),
    'A second membership for the same user and team',
    UNIQUE,
  );
});

test('foreign-keys: references to rows that do not exist are rejected', async () => {
  await fresh();
  const { core, ada } = await seedBasics();
  await expectRejected(() => insert('tasks', { team_id: 999999, title: 'Ghost team' }), 'A task for a team that does not exist', FK);
  await expectRejected(
    () => insert('memberships', { team_id: core.id, user_id: 999999 }),
    'A membership for a user that does not exist',
    FK,
  );
  await expectRejected(
    () => insert('memberships', { team_id: 999999, user_id: ada.id }),
    'A membership for a team that does not exist',
    FK,
  );
});

test('assignee-is-member: a task can only be assigned to a member of its team', async () => {
  await fresh();
  const { core, web, ada, bob } = await seedBasics();
  await expectInsertOk('tasks', { team_id: web.id, title: 'Bob works on web', assignee_id: bob.id }, 'Assigning a task to a team member');
  await expectRejected(
    () => insert('tasks', { team_id: web.id, title: 'Ada is not in Web', assignee_id: ada.id }),
    'Assigning a Web task to Ada, who is only in Core',
    ['23503', '23514', 'P0001'],
  );
  const t = await insert('tasks', { team_id: core.id, title: 'Core task', assignee_id: ada.id });
  await expectRejected(
    () => q('update tasks set team_id = $1 where id = $2', [web.id, t.id]),
    "Moving Ada's task to Web, where she is not a member",
    ['23503', '23514', 'P0001'],
  );
});

test('delete-behaviour: deletes cascade or unassign as the spec says', async () => {
  await fresh();
  const { core, web, ada, bob } = await seedBasics();
  const coreTask = await insert('tasks', { team_id: core.id, title: 'Core task', assignee_id: bob.id });
  const webTask = await insert('tasks', { team_id: web.id, title: 'Web task', assignee_id: bob.id });
  const adaTask = await insert('tasks', { team_id: core.id, title: 'Ada task', assignee_id: ada.id });

  const one = async (sql, params) => (await q(sql, params)).rows[0];

  // Bob leaves Core: his Core task is unassigned, his Web task is not.
  try {
    await q('delete from memberships where team_id = $1 and user_id = $2', [core.id, bob.id]);
  } catch (error) {
    assert.fail(`Removing Bob from Core failed with ${error.code}: ${error.message}. It should unassign his Core tasks.`);
  }
  const afterLeave = await one('select assignee_id from tasks where id = $1', [coreTask.id]);
  assert.ok(afterLeave, 'Removing a member from a team must not delete the team’s tasks.');
  assert.equal(afterLeave.assignee_id, null, 'After Bob left Core, his Core task should be unassigned.');
  const webStill = await one('select assignee_id from tasks where id = $1', [webTask.id]);
  assert.equal(String(webStill.assignee_id), String(bob.id), 'Bob left Core only; his Web task should stay assigned to him.');

  // Ada's account is deleted: her membership goes, her task stays unassigned.
  try {
    await q('delete from users where id = $1', [ada.id]);
  } catch (error) {
    assert.fail(`Deleting a user failed with ${error.code}: ${error.message}. It should remove their memberships and unassign their tasks.`);
  }
  const adaMemberships = await one('select count(*)::int as n from memberships where user_id = $1', [ada.id]);
  assert.equal(adaMemberships.n, 0, 'Deleting a user should delete their memberships.');
  const adaTaskAfter = await one('select assignee_id from tasks where id = $1', [adaTask.id]);
  assert.ok(adaTaskAfter, 'Deleting a user must not delete the tasks assigned to them.');
  assert.equal(adaTaskAfter.assignee_id, null, 'Tasks of a deleted user should be unassigned.');

  // The Web team is deleted: its tasks and memberships go with it.
  try {
    await q('delete from teams where id = $1', [web.id]);
  } catch (error) {
    assert.fail(`Deleting a team failed with ${error.code}: ${error.message}. It should delete its tasks and memberships.`);
  }
  const webLeft = await one(
    'select (select count(*) from tasks where team_id = $1)::int as tasks, (select count(*) from memberships where team_id = $1)::int as members',
    [web.id],
  );
  assert.equal(webLeft.tasks, 0, 'Deleting a team should delete its tasks.');
  assert.equal(webLeft.members, 0, 'Deleting a team should delete its memberships.');
});

test('keys-and-indexes: every table has a primary key and every foreign key is indexed', async () => {
  ready();
  const { rows: noPk } = await q(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'design' and c.relkind = 'r' and c.relname = any($1)
       and not exists (select 1 from pg_constraint p where p.conrelid = c.oid and p.contype = 'p')`,
    [TABLES],
  );
  assert.deepEqual(noPk.map((r) => r.relname), [], `These tables have no primary key: ${noPk.map((r) => r.relname).join(', ')}.`);

  // A foreign key is covered when some index on the table starts with exactly its columns (in any order).
  const { rows: fks } = await q(
    `select con.conname, rel.relname, con.conkey::int[] as cols,
            exists (
              select 1 from pg_index i
              where i.indrelid = con.conrelid
                and i.indpred is null
                and (select array_agg(k order by k) from unnest((i.indkey::int2[])[0:cardinality(con.conkey) - 1]) as k)
                    = (select array_agg(k order by k) from unnest(con.conkey) as k)
            ) as covered
     from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
     join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'design' and con.contype = 'f'`,
  );
  assert.ok(fks.length >= 3, `Expected at least three foreign keys (memberships to teams and users, tasks to teams), found ${fks.length}.`);
  const uncovered = fks.filter((f) => !f.covered).map((f) => `${f.relname} (${f.conname})`);
  assert.deepEqual(
    uncovered,
    [],
    `These foreign keys have no index that starts with their columns: ${uncovered.join(', ')}. Deletes on the parent table and joins will scan the whole child table.`,
  );
});
