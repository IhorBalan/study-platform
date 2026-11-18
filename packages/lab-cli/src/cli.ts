#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadCurriculum } from '@study/curriculum';
import { initLab, startTask } from './workspace.js';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const composeFile = path.join(repoRoot, 'infra/compose/lab.compose.yaml');
const SERVICES = ['postgres', 'valkey', 'aws', 'mailpit'];
const apiUrl = `http://localhost:${process.env.API_PORT ?? 3000}/api`;

const HELP = `Usage: pnpm lab <command>

  init <path>          Create your lab repository and tell the platform where it is
  start <task id>      Copy a task's starter files into the lab, e.g. m00-foundations/t01-raw-http-server
  images               Build the container images that run task checks (once, about 2 minutes)
  up <service...>      Start practice services: ${SERVICES.join(', ')}
  down                 Stop all practice services (data is kept)
  status               Show which practice services are running

Options:
  --lab <path>         Lab repository to use for "start" (default: the path saved in Settings)
`;

function exec(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', (error) => {
      console.error(`Could not run ${command}: ${error.message}`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const compose = (args: string[]) => exec('docker', ['compose', '-f', composeFile, ...args]);

async function savedLabPath(): Promise<string | null> {
  try {
    const res = await fetch(`${apiUrl}/settings`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return ((await res.json()) as { labRepoPath: string | null }).labRepoPath;
  } catch {
    return null;
  }
}

async function saveLabPath(labPath: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ labRepoPath: labPath }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  const labFlag = args.indexOf('--lab');
  let labOption: string | undefined;
  if (labFlag !== -1) {
    labOption = args[labFlag + 1];
    args.splice(labFlag, 2);
  }
  const [command, ...rest] = args;

  switch (command) {
    case 'init': {
      const target = rest[0];
      if (!target)
        throw new Error('Give the folder to create, e.g. pnpm lab init ~/code/backend-lab');
      const dir = path.resolve(target);
      await initLab(dir);
      console.log(`Created the lab repository at ${dir}`);
      if (await saveLabPath(dir)) {
        console.log('Saved the path in the platform settings.');
      } else {
        console.log(
          'The platform is not running, so the path was not saved. Enter it on the Settings page.',
        );
      }
      return 0;
    }
    case 'start': {
      const taskId = rest[0];
      if (!taskId)
        throw new Error('Give a task id, e.g. pnpm lab start m00-foundations/t01-raw-http-server');
      const lab = labOption ?? process.env.LAB_REPO_PATH ?? (await savedLabPath());
      if (!lab) {
        throw new Error(
          'No lab repository is known. Run "pnpm lab init <path>" first, or pass --lab <path>.',
        );
      }
      const curriculum = await loadCurriculum(path.join(repoRoot, 'curriculum'));
      const task = curriculum.modules.flatMap((m) => m.tasks).find((t) => t.id === taskId);
      if (!task) throw new Error(`Unknown task "${taskId}". Copy the id from the task page.`);
      const dest = await startTask(lab, task);
      console.log(`Task files are in ${dest}`);
      console.log(
        'Read TASK.md there, solve it, commit, then press "Run checks" on the task page.',
      );
      return 0;
    }
    case 'images': {
      const dockerfile = path.join(repoRoot, 'infra/docker/runner/Dockerfile');
      const context = path.join(repoRoot, 'infra/docker');
      for (const runner of ['node', 'nest']) {
        console.log(`Building study-runner-${runner}…`);
        const code = await exec('docker', [
          'build',
          '--target',
          runner,
          '-t',
          `study-runner-${runner}`,
          '-f',
          dockerfile,
          context,
        ]);
        if (code !== 0) return code;
      }
      return 0;
    }
    case 'up': {
      if (rest.length === 0) throw new Error(`Name the services to start: ${SERVICES.join(', ')}`);
      const unknown = rest.filter((s) => !SERVICES.includes(s));
      if (unknown.length > 0) {
        throw new Error(
          `Unknown service: ${unknown.join(', ')}. Available: ${SERVICES.join(', ')}`,
        );
      }
      return compose([...rest.flatMap((s) => ['--profile', s]), 'up', '-d', '--wait']);
    }
    case 'down':
      return compose(['--profile', '*', 'down']);
    case 'status':
      return compose(['--profile', '*', 'ps']);
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return 0;
    default:
      throw new Error(`Unknown command "${command}".\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
