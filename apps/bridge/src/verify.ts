/**
 * pnpm curriculum:verify [task id or module id ...]
 *
 * Proves what the task format promises: each task's hidden checks pass against
 * its `solution/` and fail against its `starter/`. Every run goes through the
 * same `runChecks` a learner's submission does, from a throwaway git repository.
 */
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCurriculum, type LoadedTask } from '@study/curriculum';
import { dockerAvailable, runChecks } from './checks.js';
import { loadConfig } from './config.js';
import { exec } from './exec.js';

/** How many tasks are verified at the same time. Each run may use one CPU. */
const JOBS = Math.max(1, Math.min(4, Number(process.env.VERIFY_JOBS) || 2));

type Outcome = { task: string; state: 'ok' | 'skipped' | 'wrong'; detail: string; seconds: number };

// Nothing here talks to the bridge server, so its secret is not needed.
const config = loadConfig({
  ...process.env,
  BRIDGE_SECRET: process.env.BRIDGE_SECRET ?? 'unused-by-curriculum-verify',
});

async function git(repo: string, ...args: string[]): Promise<void> {
  const result = await exec('git', ['-C', repo, ...args], { timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
}

/** Replaces the task folder with `from` and commits it. */
async function commitFolder(repo: string, task: LoadedTask, from: string, message: string) {
  const folder = path.join(repo, task.id);
  await rm(folder, { recursive: true, force: true });
  await mkdir(path.dirname(folder), { recursive: true });
  await cp(from, folder, { recursive: true });
  await git(repo, 'add', '--all', '--force');
  await git(repo, 'commit', '--quiet', '--allow-empty', '-m', message);
}

async function verifyTask(task: LoadedTask): Promise<Outcome> {
  const startedAt = Date.now();
  const done = (state: Outcome['state'], detail: string): Outcome => ({
    task: task.id,
    state,
    detail,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
  if (!task.solutionDir) return done('wrong', 'has checks but no solution/ folder');

  const repo = await mkdtemp(path.join(os.tmpdir(), 'study-verify-'));
  try {
    await git(repo, 'init', '--quiet');
    await git(repo, 'config', 'user.email', 'verify@localhost');
    await git(repo, 'config', 'user.name', 'curriculum verify');
    await git(repo, 'config', 'commit.gpgsign', 'false');

    await commitFolder(repo, task, task.solutionDir, 'solution');
    const solution = await runChecks(config, task, { taskId: task.id, repoPath: repo });
    if (solution.status === 'error') {
      const needsService =
        task.services.length > 0 && /practice service/.test(solution.message ?? '');
      return done(
        needsService ? 'skipped' : 'wrong',
        needsService
          ? `needs ${task.services.join(', ')} (start with "pnpm lab up ${task.services.join(' ')}")`
          : `the checks could not run: ${solution.message}`,
      );
    }
    const failedOnSolution = solution.results.filter((r) => !r.passed);
    if (solution.status !== 'passed') {
      const first = failedOnSolution[0];
      return done(
        'wrong',
        `solution/ fails ${failedOnSolution.length} of ${solution.results.length} checks` +
          (solution.message ? ` (${solution.message})` : '') +
          (first
            ? `\n      ${first.criterionId}: ${(first.log ?? '').split('\n')[0]?.slice(0, 200)}`
            : ''),
      );
    }

    if (!task.starterDir) {
      return done(
        'ok',
        `solution passes ${solution.results.length} checks, no starter/ to compare`,
      );
    }
    await commitFolder(repo, task, task.starterDir, 'starter');
    const starter = await runChecks(config, task, { taskId: task.id, repoPath: repo });
    if (starter.status === 'error') {
      return done('wrong', `the checks could not run on starter/: ${starter.message}`);
    }
    if (starter.status === 'passed') {
      return done('wrong', 'starter/ passes every check, so the task asks for nothing');
    }
    const failedOnStarter = starter.results.filter((r) => !r.passed).length;
    return done(
      'ok',
      `solution passes ${solution.results.length} checks, starter fails ${failedOnStarter}`,
    );
  } catch (error) {
    return done('wrong', error instanceof Error ? error.message : String(error));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

const wanted = process.argv.slice(2);
const curriculum = await loadCurriculum(config.CURRICULUM_DIR);
if (curriculum.issues.length > 0) {
  for (const issue of curriculum.issues) console.error(`${issue.file}: ${issue.message}`);
  console.error('The curriculum has errors. Run "pnpm curriculum:check" first.');
  process.exit(1);
}
const tasks = curriculum.modules
  .flatMap((m) => m.tasks)
  .filter((t) => t.type === 'repo' && t.checksDir)
  .filter((t) => wanted.length === 0 || wanted.some((w) => t.id === w || t.id.startsWith(`${w}/`)));
if (tasks.length === 0) {
  console.error(
    wanted.length > 0
      ? `No task with automated checks matches ${wanted.join(', ')}. Use a task id such as m00-foundations/t01-raw-http-server, or a module id.`
      : 'No task has automated checks.',
  );
  process.exit(1);
}
if (!(await dockerAvailable(config))) {
  console.error('Docker is not running, so the checks cannot start.');
  process.exit(1);
}

const label = { ok: 'ok     ', skipped: 'skipped', wrong: 'WRONG  ' } as const;
const outcomes: Outcome[] = [];
const queue = [...tasks];
await Promise.all(
  Array.from({ length: JOBS }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      const outcome = await verifyTask(task);
      outcomes.push(outcome);
      console.log(
        `${label[outcome.state]} ${outcome.task}  ${outcome.detail} (${outcome.seconds}s)`,
      );
    }
  }),
);

const count = (state: Outcome['state']) => outcomes.filter((o) => o.state === state).length;
console.log(
  `\n${count('ok')} correct, ${count('wrong')} wrong, ${count('skipped')} skipped, of ${tasks.length} tasks with checks.`,
);
process.exit(count('wrong') > 0 ? 1 : 0);
