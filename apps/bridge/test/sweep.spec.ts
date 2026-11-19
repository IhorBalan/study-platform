import { chmod, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { sweepLeftovers } from '../src/sweep.js';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const OLD = '2026-11-19T10:00:00.000000000Z';
const YOUNG = '2026-11-19T11:55:00.000000000Z';

describe('sweepLeftovers', () => {
  let root: string;
  let temp: string;
  let calls: string;

  /** A stand-in for docker: records each call and answers the ones the sweep reads. */
  async function fakeDocker(containers: Record<string, string>, databases: string[]) {
    const script = path.join(root, 'docker');
    const inspect = Object.entries(containers)
      .map(([id, created]) => `${id} ${created}`)
      .join('\\n');
    await writeFile(
      script,
      `#!/bin/sh
echo "$@" >> "${calls}"
case "$1 $2" in
  "ps --all") printf '${Object.keys(containers).join('\\n')}\\n' ;;
  "inspect --format") printf '${inspect}\\n' ;;
esac
if [ "$3" = "psql" ]; then printf '${databases.join('\\n')}\\n'; fi
exit 0
`,
    );
    await chmod(script, 0o755);
    return loadConfig({ BRIDGE_SECRET: 'x'.repeat(32), DOCKER_BIN: script });
  }

  async function agedFolder(name: string, ageMinutes: number) {
    const folder = path.join(temp, name);
    await mkdir(folder);
    const when = new Date(NOW - ageMinutes * 60_000);
    await utimes(folder, when, when);
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'sweep-spec-'));
    temp = path.join(root, 'tmp');
    calls = path.join(root, 'calls.log');
    await mkdir(temp);
    await writeFile(calls, '');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('removes old containers, folders and unused databases', async () => {
    const config = await fakeDocker({ aaa: OLD, bbb: OLD }, [
      'check_0123456789ab',
      'check_; drop database lab',
    ]);
    await agedFolder('study-check-old', 90);
    await agedFolder('study-review-old', 90);
    await agedFolder('study-check-new', 5);
    await agedFolder('something-else', 90);

    expect(await sweepLeftovers(config, NOW, temp)).toEqual({
      containers: 2,
      folders: 2,
      databases: 1,
    });
    expect((await readdir(temp)).toSorted()).toEqual(['something-else', 'study-check-new']);
    const log = await readFile(calls, 'utf8');
    expect(log).toContain('ps --all --quiet --filter label=study.check=1');
    expect(log).toContain('rm --force aaa bbb');
    expect(log).toContain('dropdb -U lab --if-exists check_0123456789ab');
    // A name that is not one the bridge creates never reaches dropdb.
    expect(log.match(/dropdb/g)).toHaveLength(1);
  });

  it('leaves a recent container and every database alone', async () => {
    const config = await fakeDocker({ aaa: OLD, ccc: YOUNG }, ['check_0123456789ab']);
    expect(await sweepLeftovers(config, NOW, temp)).toEqual({
      containers: 1,
      folders: 0,
      databases: 0,
    });
    const log = await readFile(calls, 'utf8');
    expect(log).toContain('rm --force aaa\n');
    expect(log).not.toContain('psql');
  });

  it('does nothing harmful when docker is missing', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: 'x'.repeat(32),
      DOCKER_BIN: path.join(root, 'no-such-docker'),
    });
    await agedFolder('study-check-old', 90);
    expect(await sweepLeftovers(config, NOW, temp)).toEqual({
      containers: 0,
      folders: 1,
      databases: 0,
    });
  });
});
