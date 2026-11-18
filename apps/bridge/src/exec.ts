import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  /** Written to the program's standard input. */
  input?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Keep only this many trailing bytes of each stream. */
  maxOutputBytes?: number;
  /** Called when the timeout fires, before the process is killed. */
  onTimeout?: () => void | Promise<void>;
}

/**
 * Keeps the last `limit` bytes of a stream. Older chunks are dropped as new ones
 * arrive, so a program that prints without end cannot fill the bridge's memory.
 */
export class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    // Drop whole chunks from the front while what remains still covers the limit.
    while (this.chunks.length > 1 && this.size - this.chunks[0]!.length >= this.limit) {
      this.size -= this.chunks.shift()!.length;
    }
  }

  toString(): string {
    const all = Buffer.concat(this.chunks);
    return (all.length > this.limit ? all.subarray(all.length - this.limit) : all).toString('utf8');
  }
}

/**
 * Runs a program with an argument array. Nothing goes through a shell, so
 * values such as paths and commit ids cannot be interpreted as commands.
 */
export function exec(file: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  const limit = options.maxOutputBytes ?? 64 * 1024;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (options.input !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.input);
    }
    const out = new TailBuffer(limit);
    const err = new TailBuffer(limit);
    let timedOut = false;
    let spawnError: Error | null = null;

    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
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
        stdout: out.toString(),
        stderr: spawnError ? spawnError.message : err.toString(),
        timedOut,
      });
    });
  });
}
