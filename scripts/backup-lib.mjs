// Shared by backup.mjs and restore.mjs: where backups live and how to reach the
// platform database, which only exists inside its container.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export const root = path.resolve(import.meta.dirname, '..');
export const backupDir = path.resolve(root, process.env.BACKUP_DIR ?? 'backups');
export const KEEP = 14;
// Names carry seconds, so two backups in one minute do not replace each other.
// Older backups were named to the minute and still count.
export const FILE_PATTERN = /^study-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?\.dump$/;
/** Written by "pnpm restore" just before it replaces the data. */
export const SAFETY_PATTERN = /^before-restore-\d{4}-\d{2}-\d{2}-\d{6}\.dump$/;
export const KEEP_SAFETY = 3;

const compose = ['compose', '-f', path.join(root, 'infra/compose/compose.yaml')];

/** Runs a command inside the platform database container, without a shell. */
export function inDatabase(args, stdio) {
  return spawn('docker', [...compose, 'exec', '-T', 'platform-db', ...args], { stdio });
}

export function finished(child) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
}

export const IF_DATABASE_DOWN =
  'If the platform database is not running, start it with "pnpm infra:up" (or "pnpm dev") and try again.';

/** Runs one SQL statement and returns its single value, or null if it could not run. */
export async function queryDatabase(sql) {
  const child = inDatabase(
    ['psql', '-U', 'study', '-d', 'study', '-Atc', sql],
    ['ignore', 'pipe', 'ignore'],
  );
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  return (await finished(child)) === 0 ? out.trim() : null;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Dumps the database into the backup folder as `<prefix>-<date>-<time>.dump` and
 * removes all but the newest `keep` files that match `pattern`.
 * Returns the file and how many old ones were removed, or an error message.
 */
export async function writeBackup({ prefix, pattern, keep }) {
  try {
    await mkdir(backupDir, { recursive: true });
  } catch (error) {
    return {
      error: `The backup folder ${backupDir} could not be used (${error.code ?? error.message}). Check BACKUP_DIR: it must be a folder.`,
    };
  }
  // A name that is already taken (two backups in one second) waits for the next second.
  let file;
  for (;;) {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    file = path.join(backupDir, `${prefix}-${stamp}.dump`);
    if (!(await stat(file).catch(() => null))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const partial = `${file}.partial`;

  const dump = inDatabase(
    // The job queue's own tables hold nothing worth keeping and do not restore cleanly.
    ['pg_dump', '-U', 'study', '--format=custom', '--exclude-schema=pgboss', 'study'],
    ['ignore', 'pipe', 'inherit'],
  );
  const [code] = await Promise.all([
    finished(dump),
    pipeline(dump.stdout, createWriteStream(partial)).catch(() => undefined),
  ]);
  if (code !== 0) {
    await rm(partial, { force: true });
    return { error: `No backup was written. ${IF_DATABASE_DOWN}` };
  }
  // The name only becomes final once the dump is complete.
  await rename(partial, file);

  const all = (await readdir(backupDir)).filter((name) => pattern.test(name)).sort();
  const old = all.slice(0, Math.max(0, all.length - keep));
  for (const name of old) await rm(path.join(backupDir, name));
  return { file, removed: old.length };
}
