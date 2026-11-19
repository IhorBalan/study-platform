// pnpm restore <file>: replaces everything in the platform database with the
// contents of one backup made by "pnpm backup".
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pipeline } from 'node:stream/promises';
import {
  IF_DATABASE_DOWN,
  KEEP_SAFETY,
  SAFETY_PATTERN,
  finished,
  inDatabase,
  queryDatabase,
  writeBackup,
} from './backup-lib.mjs';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const force = args.includes('--force');
const given = args.find((a) => !a.startsWith('--'));
if (!given) {
  console.error('Usage: pnpm restore <backup file> [--yes] [--force]');
  process.exit(1);
}
// pnpm runs scripts from the repository root; INIT_CWD is where the command was typed.
const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), given);
const info = await stat(file).catch(() => null);
if (!info?.isFile()) {
  console.error(`No backup file at ${file}.`);
  process.exit(1);
}

// Anything still connected could write while the data is replaced, and its writes
// would end up mixed into the restored data.
const others = await queryDatabase(
  "select count(*) from pg_stat_activity where datname = 'study' and pid <> pg_backend_pid()",
);
if (others === null) {
  console.error(`The platform database could not be reached. ${IF_DATABASE_DOWN}`);
  process.exit(1);
}
if (others !== '0' && !force) {
  console.error(
    `The platform is still using the database (${others} open connection(s)). Stop "pnpm dev" and anything else connected to it, then try again.\nNothing was changed. To restore anyway, add --force.`,
  );
  process.exit(1);
}

if (!yes) {
  console.log(
    `This replaces ALL current progress, cards, submissions and settings with\n${file}\n`,
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "restore" to continue: ');
  rl.close();
  if (answer.trim() !== 'restore') {
    console.log('Nothing was changed.');
    process.exit(1);
  }
}

// The backup is loaded into a new, empty database, which then takes the place of the
// current one. Restoring over the current database would keep every table the backup
// does not know (one added by a later migration), and the next start would fail when
// that migration tries to create it again. It also means a backup that cannot be read
// never touches the current data.
const SCRATCH = 'study_restoring';
const PREVIOUS = 'study_previous';
// Statements about a database cannot run from inside it, so these use "postgres".
const admin = (sql) => queryDatabase(sql, 'postgres');
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

await admin(`drop database if exists ${SCRATCH} with (force)`);
if ((await admin(`create database ${SCRATCH} owner study`)) === null) {
  fail('A database to load the backup into could not be created. Nothing was changed.');
}

const restore = inDatabase(
  [
    'pg_restore',
    '-U',
    'study',
    `--dbname=${SCRATCH}`,
    '--no-owner',
    '--single-transaction',
    '--exit-on-error',
  ],
  ['pipe', 'inherit', 'inherit'],
);
const [code] = await Promise.all([
  finished(restore),
  pipeline(createReadStream(file), restore.stdin).catch(() => undefined),
]);
if (code !== 0) {
  await admin(`drop database if exists ${SCRATCH} with (force)`);
  fail(`\nThe backup could not be read and the current data was kept. The lines above say why.`);
}

// Keep what is there now, so restoring the wrong file can be undone. This comes after
// the backup was read: a file that cannot be read must not use up a safety copy.
const safety = await writeBackup({
  prefix: 'before-restore',
  pattern: SAFETY_PATTERN,
  keep: KEEP_SAFETY,
});
if (safety.error) {
  await admin(`drop database if exists ${SCRATCH} with (force)`);
  fail(`The current data could not be saved first, so nothing was changed.\n${safety.error}`);
}
console.log(`The current data was saved to ${safety.file}.`);

if (force) {
  // A database cannot be renamed while anything is connected to it.
  await admin(
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'study' and pid <> pg_backend_pid()",
  );
}
await admin(`drop database if exists ${PREVIOUS} with (force)`);
if ((await admin(`alter database study rename to ${PREVIOUS}`)) === null) {
  await admin(`drop database if exists ${SCRATCH} with (force)`);
  fail(
    'The current database is in use and could not be replaced. The current data was kept. Stop everything connected to it and try again.',
  );
}
if ((await admin(`alter database ${SCRATCH} rename to study`)) === null) {
  await admin(`alter database ${PREVIOUS} rename to study`);
  await admin(`drop database if exists ${SCRATCH} with (force)`);
  fail('The restored data could not be put in place. The current data was kept.');
}
// The data that was replaced is in the safety backup, so this copy is not needed.
await admin(`drop database if exists ${PREVIOUS} with (force)`);

// A platform that kept running through a forced restore holds connections to the
// database that is gone, and the job queue's own tables are not part of a backup.
const next = force
  ? 'If "pnpm dev" is still running, stop it and start it again now: it cannot continue on the restored data.'
  : 'Start the platform again with "pnpm dev".';
console.log(`Restored. ${next}\nTo undo this restore: pnpm restore "${safety.file}"`);
