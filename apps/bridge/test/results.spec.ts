import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { folderBytes, readResults, watchFolderSize } from '../src/results.js';

describe('check results', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'results-spec-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads reported criteria and skips a broken last line', async () => {
    const file = path.join(dir, 'results.jsonl');
    await writeFile(
      file,
      '{"id":"a","name":"A","passed":true}\n{"id":"b","passed":false,"message":"no"}\n{"id":"c","pa',
    );
    expect(await readResults(file)).toEqual([
      { id: 'a', name: 'A', passed: true, message: null },
      { id: 'b', name: 'b', passed: false, message: 'no' },
    ]);
  });

  it('returns nothing for a missing file', async () => {
    expect(await readResults(path.join(dir, 'results.jsonl'))).toEqual([]);
  });

  it('refuses a results file over the limit without reading it', async () => {
    const file = path.join(dir, 'results.jsonl');
    await writeFile(file, '{"id":"a","passed":true}\n' + 'x'.repeat(5000));
    expect(await readResults(file, 4096)).toBeNull();
  });

  it('refuses a results file that is a link, without following it', async () => {
    const file = path.join(dir, 'results.jsonl');
    // /dev/zero reports size 0 and never ends: following it would read for ever.
    await symlink('/dev/zero', file);
    expect(await readResults(file)).toBeNull();

    await rm(file);
    const real = path.join(dir, 'real.jsonl');
    await writeFile(real, '{"id":"a","passed":true}\n');
    await symlink(real, file);
    expect(await readResults(file)).toBeNull();
  });

  it('refuses a results file that is a named pipe, without waiting on it', async () => {
    const file = path.join(dir, 'results.jsonl');
    execFileSync('mkfifo', [file]);
    expect(await readResults(file)).toBeNull();
  });

  it('counts files in subfolders and treats links and pipes as over any limit', async () => {
    await mkdir(path.join(dir, 'a', 'b'), { recursive: true });
    await writeFile(path.join(dir, 'a', 'b', 'big.bin'), 'x'.repeat(3000));
    await writeFile(path.join(dir, 'results.jsonl'), 'x'.repeat(100));
    expect(await folderBytes(dir)).toBe(3100);

    await symlink('/dev/zero', path.join(dir, 'a', 'link'));
    expect(await folderBytes(dir)).toBe(Infinity);
  });

  it('notices once when the folder grows past the limit', async () => {
    let calls = 0;
    const watch = watchFolderSize(dir, () => calls++, 4096, 10);
    await writeFile(path.join(dir, 'results.jsonl'), 'x'.repeat(1000));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(watch.exceeded()).toBe(false);

    // Any file counts, not only the results file.
    await writeFile(path.join(dir, 'other.bin'), 'x'.repeat(4000));
    expect(await folderBytes(dir)).toBe(5000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(watch.exceeded()).toBe(true);
    expect(calls).toBe(1);
    watch.stop();
  });
});
