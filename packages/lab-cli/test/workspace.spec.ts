import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCurriculum } from '@study/curriculum';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initLab, startTask } from '../src/workspace.js';

const fixtures = path.resolve(import.meta.dirname, '../../../apps/api/test/fixtures/curriculum');

describe('lab workspace', () => {
  let temp: string;
  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'lab-cli-'));
  });
  afterEach(() => rm(temp, { recursive: true, force: true }));

  const codeTask = async () => {
    const { modules } = await loadCurriculum(fixtures);
    return modules[0]!.tasks.find((t) => t.id === 'm00-demo/t02-code')!;
  };

  it('creates a git repository with a readme', async () => {
    const lab = path.join(temp, 'lab');
    await initLab(lab);
    expect(await readFile(path.join(lab, 'README.md'), 'utf8')).toContain('Backend lab');
    expect(
      execFileSync('git', ['-C', lab, 'rev-parse', '--is-inside-work-tree']).toString(),
    ).toContain('true');
  });

  it('refuses to initialise a folder that has files', async () => {
    await writeFile(path.join(temp, 'notes.txt'), 'mine');
    await expect(initLab(temp)).rejects.toThrow('not empty');
    expect(await readFile(path.join(temp, 'notes.txt'), 'utf8')).toBe('mine');
  });

  it('copies the starter and the brief, but never the solution or the checks', async () => {
    const lab = path.join(temp, 'lab');
    await initLab(lab);
    const dest = await startTask(lab, await codeTask());
    expect(await readFile(path.join(dest, 'index.mjs'), 'utf8')).toContain("greeting = ''");
    expect(await readFile(path.join(dest, 'TASK.md'), 'utf8')).toContain('# Write a greeting');
    const tracked = execFileSync('ls', ['-R', dest]).toString();
    expect(tracked).not.toContain('solution');
    expect(tracked).not.toContain('test.mjs');
  });

  it('does not overwrite a task that was already started', async () => {
    const lab = path.join(temp, 'lab');
    await initLab(lab);
    const task = await codeTask();
    const dest = await startTask(lab, task);
    await writeFile(path.join(dest, 'index.mjs'), 'my work');
    await expect(startTask(lab, task)).rejects.toThrow('already exists');
    expect(await readFile(path.join(dest, 'index.mjs'), 'utf8')).toBe('my work');
  });

  it('explains what to do when the folder is not a lab repository', async () => {
    await expect(startTask(temp, await codeTask())).rejects.toThrow('pnpm lab init');
  });
});
