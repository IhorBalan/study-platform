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
  console.error(`\nNo backup was written. ${IF_DATABASE_DOWN}`);
  process.exit(1);
}
// The name only becomes final once the dump is complete.
await rename(partial, file);

const all = (await readdir(backupDir)).filter((name) => FILE_PATTERN.test(name)).sort();
const old = all.slice(0, Math.max(0, all.length - KEEP));
for (const name of old) await rm(path.join(backupDir, name));

const { size } = await stat(file);
console.log(`Backup written: ${file} (${(size / 1024).toFixed(0)} KB).`);
if (old.length > 0)
  console.log(`Removed ${old.length} older backup(s); the newest ${KEEP} are kept.`);
