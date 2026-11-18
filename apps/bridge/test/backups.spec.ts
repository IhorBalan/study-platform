import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lastBackupAt } from '../src/backups.js';

describe('lastBackupAt', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'study-backups-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('is null for a missing or empty folder', async () => {
    expect(await lastBackupAt(path.join(dir, 'nope'))).toBeNull();
    expect(await lastBackupAt(dir)).toBeNull();
  });

  it('gives the time of the newest backup and ignores other files', async () => {
    const at = (name: string, iso: string) =>
      writeFile(path.join(dir, name), '').then(() =>
        utimes(path.join(dir, name), new Date(iso), new Date(iso)),
      );
    await at('study-2026-11-10-0900.dump', '2026-11-10T09:00:00Z');
    await at('study-2026-11-12-090000.dump', '2026-11-12T09:00:00Z');
    // Safety copies and stray files are not backups the learner made.
    await at('before-restore-2026-11-15-090000.dump', '2026-11-15T09:00:00Z');
    await at('notes.txt', '2026-11-16T09:00:00Z');
    expect(await lastBackupAt(dir)).toBe('2026-11-12T09:00:00.000Z');
  });
});
