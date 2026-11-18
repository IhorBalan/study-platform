import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
