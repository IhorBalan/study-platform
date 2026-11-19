import { randomUUID } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Config } from './config.js';
import { exec } from './exec.js';

/** The label every check container carries, so leftovers can be found again. */
export const CHECK_LABEL = 'study.check=1';

/** A second label says which process started the container and so owns its time limit. */
export const OWNER_LABEL = 'study.check.owner';
/** New for every bridge process, so a bridge can tell its own containers from an earlier one's. */
export const BRIDGE_OWNER = `bridge-${randomUUID()}`;
/** `pnpm curriculum:verify` runs next to the bridge and may be in the middle of a check. */
export const VERIFY_OWNER = 'verify';

/**
 * Longer than the longest time limit a task may set (15 minutes). Used where the owner
 * cannot be told: containers of `pnpm curriculum:verify`, and temporary folders.
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
 * A container that another bridge process started is removed whatever its age:
 * only one bridge runs at a time, so its owner is gone and nothing limits it any more.
 * That covers the common case of a crash followed by a restart a minute later.
 *
 * Runs once when the bridge starts. Every step is best effort: without Docker,
 * or with the practice database stopped, it removes what it can and moves on.
 */
export async function sweepLeftovers(
  config: Config,
  now = Date.now(),
  tempRoot = os.tmpdir(),
  self = BRIDGE_OWNER,
): Promise<SweepResult> {
  const result: SweepResult = { containers: 0, folders: 0, databases: 0 };
  const docker = config.DOCKER_BIN;

  // Containers that stay: they may be about to use a practice database.
  let kept = 0;
  const listed = await exec(
    docker,
    ['ps', '--all', '--quiet', '--filter', `label=${CHECK_LABEL}`],
    {
      timeoutMs: 15_000,
    },
  );
  const ids = listed.code === 0 ? listed.stdout.split('\n').filter(Boolean) : [];
  if (ids.length > 0) {
    const inspected = await exec(
      docker,
      [
        'inspect',
        '--format',
        `{{.Id}} {{.Created}} {{index .Config.Labels "${OWNER_LABEL}"}}`,
        ...ids,
      ],
      {
        timeoutMs: 15_000,
      },
    );
    const orphans: string[] = [];
    for (const line of inspected.stdout.split('\n').filter(Boolean)) {
      const [id, created, owner = ''] = line.split(' ');
      const createdAt = Date.parse(created ?? '');
      const fromEarlierBridge = owner.startsWith('bridge-') && owner !== self;
      const old = Number.isFinite(createdAt) && now - createdAt > MAX_AGE_MS;
      if (id && (fromEarlierBridge || old)) orphans.push(id);
      else kept++;
    }
    if (orphans.length > 0) {
      const removed = await exec(docker, ['rm', '--force', ...orphans], { timeoutMs: 30_000 });
      if (removed.code === 0) result.containers = orphans.length;
      else kept += orphans.length;
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
  if (listed.code === 0 && kept === 0) {
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
