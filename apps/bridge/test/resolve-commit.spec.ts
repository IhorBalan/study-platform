import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveCommit } from '../src/checks.js';

describe('resolveCommit', () => {
  let repo: string;
  let first: string;
  let second: string;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'resolve-commit-'));
    git('init', '--quiet');
    git('config', 'user.email', 'learner@example.com');
    git('config', 'user.name', 'Learner');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(path.join(repo, 'a.txt'), 'starter');
    git('add', '.');
    git('commit', '--quiet', '-m', 'starter');
    first = git('rev-parse', 'HEAD');
    writeFileSync(path.join(repo, 'a.txt'), 'solution');
    git('commit', '--quiet', '-am', 'solution');
    second = git('rev-parse', 'HEAD');
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('gives the latest commit when none is named', async () => {
    expect(await resolveCommit(repo)).toBe(second);
  });

  it('gives the full id for a short one', async () => {
    expect(await resolveCommit(repo, first.slice(0, 8))).toBe(first);
  });

  it('gives null for a commit the repository does not have', async () => {
    expect(await resolveCommit(repo, 'deadbeef')).toBeNull();
  });

  it('gives null for a folder that is not a repository, or a relative path', async () => {
    expect(await resolveCommit(path.join(repo, 'missing'))).toBeNull();
    expect(await resolveCommit('lab')).toBeNull();
  });
});
