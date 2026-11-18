// pnpm backup: writes one compressed dump of the platform database (progress,
// cards, submissions, reviews, settings) and keeps the newest few.
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  backupDir,
  FILE_PATTERN,
  finished,
  IF_DATABASE_DOWN,
  inDatabase,
  KEEP,
} from './backup-lib.mjs';

// --daily is how "pnpm dev" calls this: at most one backup a day, and never a reason
// for the platform not to start.
const daily = process.argv.includes('--daily');
const DAY_MS = 24 * 60 * 60 * 1000;

if (daily) {
  const names = await readdir(backupDir).catch(() => []);
  const newest = names
    .filter((name) => FILE_PATTERN.test(name))
    .sort()
    .at(-1);
  const age = newest
    ? Date.now() - (await stat(path.join(backupDir, newest))).mtimeMs
    : Number.POSITIVE_INFINITY;
  if (age < DAY_MS) process.exit(0);

  // A database that has never been migrated has nothing to keep yet.
  const probe = inDatabase(
    [
      'psql',
      '-U',
      'study',
      '-d',
      'study',
      '-Atc',
      "select to_regclass('public.cards') is not null",
    ],
    ['ignore', 'pipe', 'ignore'],
  );
  let answer = '';
  probe.stdout.on('data', (chunk) => (answer += chunk));
  if ((await finished(probe)) !== 0 || answer.trim() !== 't') process.exit(0);
}

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const file = path.join(backupDir, `study-${stamp}.dump`);
const partial = `${file}.partial`;

await mkdir(backupDir, { recursive: true });

const dump = inDatabase(
  // The job queue's own tables hold nothing worth keeping and do not restore cleanly.
  ['pg_dump', '-U', 'study', '--format=custom', '--exclude-schema=pgboss', 'study'],
  ['ignore', 'pipe', 'inherit'],
);
const [code] = await Promise.all([
  finished(dump),
  pipeline(dump.stdout, createWriteStream(partial)),
]);
if (code !== 0) {
  await rm(partial, { force: true });
  if (daily) {
    console.warn('The daily backup could not be written. Run "pnpm backup" to see why.');
    process.exit(0);
  }
  console.error(`\nNo backup was written. ${IF_DATABASE_DOWN}`);
  process.exit(1);
}
// The name only becomes final once the dump is complete.
await rename(partial, file);

const all = (await readdir(backupDir)).filter((name) => FILE_PATTERN.test(name)).sort();
const old = all.slice(0, Math.max(0, all.length - KEEP));
for (const name of old) await rm(path.join(backupDir, name));

const { size } = await stat(file);
console.log(
  `${daily ? 'Daily backup' : 'Backup'} written: ${file} (${(size / 1024).toFixed(0)} KB).`,
);
if (old.length > 0)
  console.log(`Removed ${old.length} older backup(s); the newest ${KEEP} are kept.`);
