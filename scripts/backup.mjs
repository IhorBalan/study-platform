// pnpm backup: writes one compressed dump of the platform database (progress,
// cards, submissions, reviews, settings) and keeps the newest few.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { backupDir, FILE_PATTERN, KEEP, queryDatabase, writeBackup } from './backup-lib.mjs';

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
  if ((await queryDatabase("select to_regclass('public.cards') is not null")) !== 't')
    process.exit(0);
}

const result = await writeBackup({ prefix: 'study', pattern: FILE_PATTERN, keep: KEEP });
if (result.error) {
  if (daily) {
    console.warn('The daily backup could not be written. Run "pnpm backup" to see why.');
    process.exit(0);
  }
  console.error(`\n${result.error}`);
  process.exit(1);
}
const { file, removed } = result;

const { size } = await stat(file);
console.log(
  `${daily ? 'Daily backup' : 'Backup'} written: ${file} (${(size / 1024).toFixed(0)} KB).`,
);
if (removed > 0) console.log(`Removed ${removed} older backup(s); the newest ${KEEP} are kept.`);
