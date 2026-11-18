import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** The names "pnpm backup" gives its files (scripts/backup-lib.mjs). */
const BACKUP_FILE = /^study-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?\.dump$/;

/** When the newest backup was written, or null when the folder has none. */
export async function lastBackupAt(dir: string): Promise<string | null> {
  const names = await readdir(dir).catch(() => [] as string[]);
  let newest = 0;
  for (const name of names) {
    if (!BACKUP_FILE.test(name)) continue;
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info?.isFile() && info.mtimeMs > newest) newest = info.mtimeMs;
  }
  return newest > 0 ? new Date(newest).toISOString() : null;
}
