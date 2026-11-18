// pnpm restore <file>: replaces everything in the platform database with the
// contents of one backup made by "pnpm backup".
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pipeline } from 'node:stream/promises';
import { IF_DATABASE_DOWN, finished, inDatabase } from './backup-lib.mjs';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const given = args.find((a) => !a.startsWith('--'));
if (!given) {
  console.error('Usage: pnpm restore <backup file> [--yes]');
  process.exit(1);
}
// pnpm runs scripts from the repository root; INIT_CWD is where the command was typed.
const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), given);
const info = await stat(file).catch(() => null);
if (!info?.isFile()) {
  console.error(`No backup file at ${file}.`);
  process.exit(1);
}

if (!yes) {
  console.log(
    `This replaces ALL current progress, cards, submissions and settings with\n${file}\n`,
  );
  console.log('Stop "pnpm dev" first, so nothing writes while the data is replaced.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "restore" to continue: ');
  rl.close();
  if (answer.trim() !== 'restore') {
    console.log('Nothing was changed.');
    process.exit(1);
  }
}

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
    `\nThe restore did not finish and the current data was kept. The lines above say why.\n${IF_DATABASE_DOWN}`,
  );
  process.exit(1);
}
console.log('Restored. Start the platform again with "pnpm dev".');
