import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Keep only this many trailing bytes of each stream. */
  maxOutputBytes?: number;
  /** Called when the timeout fires, before the process is killed. */
  onTimeout?: () => void | Promise<void>;
}

function tail(buffer: Buffer[], limit: number): string {
  const all = Buffer.concat(buffer);
  return (all.length > limit ? all.subarray(all.length - limit) : all).toString('utf8');
}

/**
 * Runs a program with an argument array. Nothing goes through a shell, so
 * values such as paths and commit ids cannot be interpreted as commands.
 */
export function exec(file: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  const limit = options.maxOutputBytes ?? 64 * 1024;
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let spawnError: Error | null = null;

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => {
      spawnError = error;
    });

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          void Promise.resolve(options.onTimeout?.()).finally(() => child.kill('SIGKILL'));
        }, options.timeoutMs)
      : null;

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: spawnError ? null : code,
        stdout: tail(out, limit),
        stderr: spawnError ? spawnError.message : tail(err, limit),
        timedOut,
      });
    });
  });
}
