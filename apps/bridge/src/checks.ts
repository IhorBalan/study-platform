import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LoadedTask } from '@study/curriculum';
import type { CheckResultDto, RunChecksRequest, RunChecksResponse } from '@study/shared';
import type { Config } from './config.js';
import { exec, TailBuffer } from './exec.js';
import { readResults, watchFolderSize, type ReportedResult } from './results.js';
import { prepareServices } from './services.js';

const RUNNER_IMAGES = { node: 'study-runner-node', nest: 'study-runner-nest' } as const;
const DEFAULT_MEMORY_MB = { node: 512, nest: 1024 } as const;
const DEFAULT_TIMEOUT_SECONDS = 120;

export function runnerImage(runner: keyof typeof RUNNER_IMAGES): string {
  return RUNNER_IMAGES[runner];
}

export async function imageExists(config: Config, image: string): Promise<boolean> {
  const result = await exec(config.DOCKER_BIN, ['image', 'inspect', image], { timeoutMs: 10_000 });
  return result.code === 0;
}

export async function dockerAvailable(config: Config): Promise<boolean> {
  const result = await exec(config.DOCKER_BIN, ['version', '--format', '{{.Server.Version}}'], {
    timeoutMs: 5_000,
  });
  return result.code === 0;
}

/** The sandbox network has no internet. Lab services join it when they are started. */
async function ensureNetwork(config: Config): Promise<string | null> {
  const inspect = await exec(config.DOCKER_BIN, ['network', 'inspect', config.LAB_NETWORK], {
    timeoutMs: 10_000,
  });
  if (inspect.code === 0) return null;
  const create = await exec(
    config.DOCKER_BIN,
    ['network', 'create', '--internal', config.LAB_NETWORK],
    { timeoutMs: 20_000 },
  );
  // Another run may have created it in the meantime.
  if (create.code !== 0 && !create.stderr.includes('already exists')) {
    return `Could not create the Docker network ${config.LAB_NETWORK}: ${create.stderr.trim()}`;
  }
  return null;
}

/** `git archive <sha> <folder> | tar -x -C <dest>`, without a shell. */
export function exportFolder(
  repo: string,
  sha: string,
  folder: string,
  dest: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const git = spawn('git', ['-C', repo, 'archive', '--format=tar', sha, '--', folder], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tar = spawn('tar', ['-x', '-C', dest], { stdio: ['pipe', 'ignore', 'pipe'] });
    // Only the end of the error output is shown, so only that much is kept.
    const stderr = new TailBuffer(16 * 1024);
    git.stderr.on('data', (c: Buffer) => stderr.push(c));
    tar.stderr.on('data', (c: Buffer) => stderr.push(c));
    git.stdout.pipe(tar.stdin);
    git.on('error', (e) => stderr.push(Buffer.from(e.message)));
    tar.on('error', (e) => stderr.push(Buffer.from(e.message)));
    // The two processes can finish in either order, so wait for both exit codes.
    const exited = (child: typeof git | typeof tar) =>
      new Promise<number | null>((done) => child.on('close', done));
    void Promise.all([exited(git), exited(tar)]).then(([gitCode, tarCode]) => {
      resolve(
        gitCode === 0 && tarCode === 0 ? null : stderr.toString().trim() || 'git archive failed',
      );
    });
  });
}

/** One entry per criterion in the task file, in that order. */
function matchCriteria(task: LoadedTask, reported: ReportedResult[]): CheckResultDto[] {
  return task.criteria.map((criterion) => {
    const rows = reported.filter((r) => r.id === criterion.id);
    if (rows.length === 0) {
      return {
        criterionId: criterion.id,
        title: criterion.title,
        passed: false,
        log: 'The checks stopped before this one reported a result.',
      };
    }
    const failed = rows.filter((r) => !r.passed);
    return {
      criterionId: criterion.id,
      title: criterion.title,
      passed: failed.length === 0,
      log:
        failed
          .map((r) => r.message)
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 8_000) || null,
    };
  });
}

function failure(
  message: string,
  startedAt: number,
  commitSha: string | null = null,
): RunChecksResponse {
  return {
    status: 'error',
    message,
    commitSha,
    results: [],
    log: '',
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Exports the task folder at one commit and runs the task's hidden check suite
 * against it inside a locked-down container.
 */
export async function runChecks(
  config: Config,
  task: LoadedTask,
  request: RunChecksRequest,
): Promise<RunChecksResponse> {
  const startedAt = Date.now();
  const repo = request.repoPath;

  if (!task.checksDir) return failure('This task has no automated checks.', startedAt);
  if (!path.isAbsolute(repo))
    return failure('The lab repository path must be absolute.', startedAt);
  const repoStat = await stat(repo).catch(() => null);
  if (!repoStat?.isDirectory()) {
    return failure(`The lab repository was not found at ${repo}.`, startedAt);
  }

  const revision = `${request.commitSha ?? 'HEAD'}^{commit}`;
  const resolved = await exec('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', revision], {
    timeoutMs: 10_000,
  });
  if (resolved.code !== 0) {
    return failure(
      request.commitSha
        ? `Commit ${request.commitSha} was not found in the lab repository.`
        : 'The lab repository has no commits yet. Commit your work first.',
      startedAt,
    );
  }
  const sha = resolved.stdout.trim();

  const folder = task.id;
  const exists = await exec('git', ['-C', repo, 'cat-file', '-e', `${sha}:${folder}`], {
    timeoutMs: 10_000,
  });
  if (exists.code !== 0) {
    return failure(
      `The folder ${folder} does not exist in commit ${sha.slice(0, 10)}. Run "pnpm lab start ${task.id}" and commit your work.`,
      startedAt,
      sha,
    );
  }

  const image = runnerImage(task.runner);
  if (!(await imageExists(config, image))) {
    return failure(
      `The check image ${image} is not built yet. Run "pnpm lab images" once.`,
      startedAt,
      sha,
    );
  }
  const networkError = await ensureNetwork(config);
  if (networkError) return failure(networkError, startedAt, sha);

  const services = await prepareServices(config, task.services);
  if (typeof services === 'string') return failure(services, startedAt, sha);

  const temp = await mkdtemp(path.join(os.tmpdir(), 'study-check-'));
  const name = `study-check-${randomUUID()}`;
  try {
    const exportDir = path.join(temp, 'export');
    const resultsDir = path.join(temp, 'results');
    await mkdir(exportDir);
    await mkdir(resultsDir);
    // The sandbox user is not the host user, so it needs write access to the results folder.
    await chmod(resultsDir, 0o777);
    await chmod(temp, 0o755);

    const exportError = await exportFolder(repo, sha, folder, exportDir);
    if (exportError) return failure(`Could not export the commit: ${exportError}`, startedAt, sha);

    const memoryMb = task.limits.memoryMb ?? DEFAULT_MEMORY_MB[task.runner];
    const cpus = task.limits.cpus ?? 1;
    const timeoutSeconds = task.limits.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

    // Stop the run if it writes far more results than any check suite does.
    const resultsSize = watchFolderSize(resultsDir, () => {
      void exec(config.DOCKER_BIN, ['kill', name], { timeoutMs: 15_000 });
    });
    const run = await exec(
      config.DOCKER_BIN,
      [
        'run',
        '--rm',
        '--name',
        name,
        '--network',
        config.LAB_NETWORK,
        '--memory',
        `${memoryMb}m`,
        '--cpus',
        String(cpus),
        '--pids-limit',
        '256',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,exec,size=128m',
        '--tmpfs',
        '/work:rw,exec,size=256m,uid=10001,gid=10001',
        '--user',
        '10001:10001',
        ...Object.entries(services.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
        '-v',
        `${path.join(exportDir, folder)}:/submission:ro`,
        '-v',
        `${task.checksDir}:/checks:ro`,
        '-v',
        `${resultsDir}:/results`,
        image,
      ],
      {
        timeoutMs: timeoutSeconds * 1000,
        onTimeout: async () => {
          await exec(config.DOCKER_BIN, ['kill', name], { timeoutMs: 15_000 });
        },
      },
    );

    resultsSize.stop();
    const read = await readResults(path.join(resultsDir, 'results.jsonl'));
    const log = `${run.stdout}${run.stderr ? `\n${run.stderr}` : ''}`.slice(-32_000);

    if (read === null || resultsSize.exceeded()) {
      return {
        status: 'failed',
        message:
          'The checks wrote far more to their results folder than expected, so the run was stopped and its results were discarded.',
        commitSha: sha,
        results: matchCriteria(task, []),
        log,
        durationMs: Date.now() - startedAt,
      };
    }
    const reported = read;

    if (run.timedOut) {
      return {
        status: 'failed',
        message: `The checks did not finish within ${timeoutSeconds} seconds and were stopped.`,
        commitSha: sha,
        results: matchCriteria(task, reported),
        log,
        durationMs: Date.now() - startedAt,
      };
    }
    // 125 to 127 come from Docker itself: the container never ran the checks.
    if (reported.length === 0 && (run.code === null || run.code >= 125)) {
      return {
        ...failure(
          `The sandbox could not start: ${run.stderr.trim().slice(0, 500)}`,
          startedAt,
          sha,
        ),
        log,
      };
    }

    const results = matchCriteria(task, reported);
    return {
      status: results.every((r) => r.passed) ? 'passed' : 'failed',
      message: null,
      commitSha: sha,
      results,
      log,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await services.cleanup();
    await rm(temp, { recursive: true, force: true });
  }
}
