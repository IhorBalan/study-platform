import { readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Config } from './config.js';
import { exec } from './exec.js';

/** The label every check container carries, so leftovers can be found again. */
export const CHECK_LABEL = 'study.check=1';

/**
 * Longer than the longest time limit a task may set (15 minutes), so nothing
 * that is still running, here or in `pnpm curriculum:verify`, is touched.
 */
const MAX_AGE_MS = 30 * 60 * 1000;
const TEMP_PREFIXES = ['study-check-', 'study-review-'];
const LAB_POSTGRES = 'study-lab-postgres-1';

export interface SweepResult {
  containers: number;
  folders: number;
  databases: number;
}

/**
 * Removes what a check run leaves behind when the bridge stops before the run
 * does (a crash, a kill, a closed laptop): its container, which would otherwise
 * run without a time limit, its temporary folder and its practice database.
 *
 * Runs once when the bridge starts. Every step is best effort: without Docker,
 * or with the practice database stopped, it removes what it can and moves on.
 */
export async function sweepLeftovers(
  config: Config,
  now = Date.now(),
  tempRoot = os.tmpdir(),
): Promise<SweepResult> {
  const result: SweepResult = { containers: 0, folders: 0, databases: 0 };
  const docker = config.DOCKER_BIN;

  let young = 0;
  const listed = await exec(
    docker,
    ['ps', '--all', '--quiet', '--filter', `label=${CHECK_LABEL}`],
    {
      timeoutMs: 15_000,
    },
  );
  const ids = listed.code === 0 ? listed.stdout.split('\n').filter(Boolean) : [];
  if (ids.length > 0) {
    const inspected = await exec(docker, ['inspect', '--format', '{{.Id}} {{.Created}}', ...ids], {
      timeoutMs: 15_000,
    });
    const old: string[] = [];
    for (const line of inspected.stdout.split('\n').filter(Boolean)) {
      const [id, created] = line.split(' ');
      const createdAt = Date.parse(created ?? '');
      if (id && Number.isFinite(createdAt) && now - createdAt > MAX_AGE_MS) old.push(id);
      else young++;
    }
    if (old.length > 0) {
      const removed = await exec(docker, ['rm', '--force', ...old], { timeoutMs: 30_000 });
      if (removed.code === 0) result.containers = old.length;
    }
  }

  for (const name of await readdir(tempRoot).catch(() => [] as string[])) {
    if (!TEMP_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const folder = path.join(tempRoot, name);
    const info = await stat(folder).catch(() => null);
    if (!info?.isDirectory() || now - info.mtimeMs <= MAX_AGE_MS) continue;
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    result.folders++;
  }

  // A database has no creation time to go by, so drop only the unused ones, and
  // only when no check container is left that could be about to use one.
  if (listed.code === 0 && young === 0) {
    const unused = await exec(
      docker,
      [
        'exec',
        LAB_POSTGRES,
        'psql',
        '-U',
        'lab',
        '-d',
        'postgres',
        '-At',
        '-c',
        "select datname from pg_database d where datname like 'check\\_%' and not exists (select 1 from pg_stat_activity a where a.datname = d.datname)",
      ],
      { timeoutMs: 20_000 },
    );
    if (unused.code === 0) {
      for (const database of unused.stdout.split('\n').map((line) => line.trim())) {
        // The names come from the database: accept only the shape the bridge itself creates.
        if (!/^check_[0-9a-f]{12}$/.test(database)) continue;
        const dropped = await exec(
          docker,
          ['exec', LAB_POSTGRES, 'dropdb', '-U', 'lab', '--if-exists', database],
          { timeoutMs: 20_000 },
        );
        if (dropped.code === 0) result.databases++;
      }
    }
  }
  return result;
}
