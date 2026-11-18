// Shared by backup.mjs and restore.mjs: where backups live and how to reach the
// platform database, which only exists inside its container.
import { spawn } from 'node:child_process';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
export const backupDir = path.resolve(root, process.env.BACKUP_DIR ?? 'backups');
export const KEEP = 14;
export const FILE_PATTERN = /^study-\d{4}-\d{2}-\d{2}-\d{4}\.dump$/;

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
