import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { LoadedTask } from '@study/curriculum';

const run = promisify(execFile);

const README = `# Backend lab

Your solutions to the study platform's tasks. One folder per task:

    m00-foundations/t01-raw-http-server/

Workflow for a task:

1. \`pnpm lab start <task id>\` in the platform repository copies the starter files here.
2. Solve the task and commit.
3. Press "Run checks" on the task page. The checks run against the commit, in a
   container with no internet, so uncommitted changes are not seen.
`;

const GITIGNORE = `node_modules/
dist/
.env
*.log
.DS_Store
`;

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

/** Creates the lab repository. Refuses to touch a folder that already has content. */
export async function initLab(target: string): Promise<void> {
  const dir = path.resolve(target);
  if (await exists(dir)) {
    const entries = await readdir(dir);
    if (entries.length > 0) {
      throw new Error(`${dir} already exists and is not empty. Choose a new folder.`);
    }
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'README.md'), README);
  await writeFile(path.join(dir, '.gitignore'), GITIGNORE);
  await run('git', ['-C', dir, 'init', '--quiet', '--initial-branch=main']);
  await run('git', ['-C', dir, 'add', '-A']);
  // Uses the learner's own git identity. If none is set, the first commit is theirs to make.
  await run('git', ['-C', dir, 'commit', '--quiet', '-m', 'Create lab repository']).catch(
    () => undefined,
  );
}

/** Copies a task's starter files and brief into the lab. Never overwrites existing work. */
export async function startTask(labDir: string, task: LoadedTask): Promise<string> {
  const lab = path.resolve(labDir);
  if (!(await exists(path.join(lab, '.git')))) {
    throw new Error(`${lab} is not a lab repository. Create one with "pnpm lab init <path>".`);
  }
  const dest = path.join(lab, task.id);
  if (await exists(dest)) {
    throw new Error(`${dest} already exists. Your work there was left untouched.`);
  }
  await mkdir(dest, { recursive: true });
  if (task.starterDir) await cp(task.starterDir, dest, { recursive: true });
  await writeFile(path.join(dest, 'TASK.md'), `# ${task.title}\n\n${task.markdown.trim()}\n`);
  return dest;
}
