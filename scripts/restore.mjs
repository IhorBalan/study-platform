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

// Keep what is there now, so restoring the wrong file can be undone.
const safety = await writeBackup({
  prefix: 'before-restore',
  pattern: SAFETY_PATTERN,
  keep: KEEP_SAFETY,
});
if (safety.error) {
  console.error(
    `The current data could not be saved first, so nothing was changed.\n${safety.error}`,
  );
  process.exit(1);
}
console.log(`The current data was saved to ${safety.file}.`);

// One transaction: a backup that cannot be read leaves the current data as it was.
const restore = inDatabase(
  [
    'pg_restore',
    '-U',
    'study',
    '--dbname=study',
    '--clean',
    '--if-exists',
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
  console.error(
    `\nThe restore did not finish and the current data was kept. The lines above say why.`,
  );
  process.exit(1);
}
console.log(
  `Restored. Start the platform again with "pnpm dev".\nTo undo this restore: pnpm restore "${safety.file}"`,
);
