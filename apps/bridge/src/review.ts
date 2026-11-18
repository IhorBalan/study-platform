import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LoadedTask } from '@study/curriculum';
import { ReviewResult, type RunReviewRequest, type RunReviewResponse } from '@study/shared';
import { z } from 'zod';
import { exportFolder } from './checks.js';
import type { Config } from './config.js';
import { exec } from './exec.js';

const REVIEW_TIMEOUT_MS = 6 * 60 * 1000;
/**
 * Files in a submission that would change how the CLI behaves. Project settings
 * can define hooks, which run shell commands on the host, so none of these may
 * reach the directory the CLI runs in.
 */
const STRIPPED = new Set(['.claude', '.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md']);

export async function claudeAvailable(config: Config): Promise<boolean> {
  const result = await exec(config.CLAUDE_BIN, ['--version'], { timeoutMs: 10_000 });
  return result.code === 0;
}

async function stripAgentFiles(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (STRIPPED.has(entry.name)) await rm(full, { recursive: true, force: true });
    else if (entry.isDirectory()) await stripAgentFiles(full);
  }
}

/** The fixed command line. Nothing in it comes from a request. */
export function claudeArgs(): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(z.toJSONSchema(ReviewResult)),
    // Only the learner's own user settings: never settings found in the folder under review.
    '--setting-sources',
    'user',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--allowedTools',
    'Read,Grep,Glob',
    '--disallowedTools',
    'Bash,Edit,Write,WebFetch,WebSearch',
    '--permission-mode',
    'dontAsk',
    '--no-session-persistence',
  ];
}

function failure(message: string, startedAt: number): RunReviewResponse {
  return {
    status: 'error',
    message,
    output: '',
    model: null,
    costUsd: null,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Runs one review with the learner's own Claude login. Claude gets read-only
 * tools and a working directory that holds nothing but the exported task folder.
 */
export async function runReview(
  config: Config,
  task: LoadedTask,
  request: RunReviewRequest,
): Promise<RunReviewResponse> {
  const startedAt = Date.now();
  if (!(await claudeAvailable(config))) {
    return failure(
      'The Claude CLI was not found on this computer. Install Claude Code and sign in, or use copy and paste.',
      startedAt,
    );
  }

  const temp = await mkdtemp(path.join(os.tmpdir(), 'study-review-'));
  try {
    const workDir = path.join(temp, 'work');
    await mkdir(workDir);

    if (task.type === 'repo') {
      const repo = request.repoPath;
      if (!repo || !path.isAbsolute(repo) || !(await stat(repo).catch(() => null))?.isDirectory()) {
        return failure(
          'The lab repository was not found. Check its path on the Settings page.',
          startedAt,
        );
      }
      const revision = `${request.commitSha ?? 'HEAD'}^{commit}`;
      const resolved = await exec(
        'git',
        ['-C', repo, 'rev-parse', '--verify', '--quiet', revision],
        {
          timeoutMs: 10_000,
        },
      );
      if (resolved.code !== 0) return failure('The submitted commit was not found.', startedAt);
      const exportError = await exportFolder(repo, resolved.stdout.trim(), task.id, workDir);
      if (exportError) return failure(`Could not export the commit: ${exportError}`, startedAt);
      await stripAgentFiles(workDir);
    }

    const run = await exec(config.CLAUDE_BIN, claudeArgs(), {
      cwd: workDir,
      input: request.prompt,
      timeoutMs: REVIEW_TIMEOUT_MS,
      maxOutputBytes: 2 * 1024 * 1024,
    });
    if (run.timedOut) return failure('Claude did not finish within 6 minutes.', startedAt);

    let envelope: Record<string, unknown> | null = null;
    try {
      envelope = JSON.parse(run.stdout) as Record<string, unknown>;
    } catch {
      // handled below
    }
    if (!envelope || run.code !== 0 || envelope.is_error === true) {
      const detail =
        (typeof envelope?.result === 'string' && envelope.result) ||
        run.stderr.trim().slice(0, 400) ||
        `exit code ${run.code}`;
      return failure(
        `Claude could not complete the review: ${detail}. If you are not signed in, run "claude" once in a terminal.`,
        startedAt,
      );
    }

    const structured = envelope.structured_output;
    const output =
      structured !== undefined && structured !== null
        ? JSON.stringify(structured)
        : typeof envelope.result === 'string'
          ? envelope.result
          : '';
    const usage = envelope.modelUsage;
    return {
      status: 'ok',
      message: null,
      output,
      model: usage && typeof usage === 'object' ? (Object.keys(usage)[0] ?? null) : null,
      costUsd: typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : null,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
