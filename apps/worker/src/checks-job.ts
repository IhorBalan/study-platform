import { schema, type Database } from '@study/db';
import { and, eq } from 'drizzle-orm';
import { BridgeUnavailableError, type RunChecksOnBridge } from './bridge-client.js';

const { submissions, verificationRuns, checkResults, settings } = schema;

export interface ChecksJobDeps {
  db: Database;
  runOnBridge: RunChecksOnBridge;
}

/**
 * Runs stage 1 for one queued run and records the outcome. It never throws:
 * every failure ends up on the run row, where the learner can read it.
 */
export async function processChecksJob(deps: ChecksJobDeps, runId: string): Promise<void> {
  const { db } = deps;
  const finish = (values: Partial<typeof verificationRuns.$inferInsert>) =>
    db
      .update(verificationRuns)
      .set({ ...values, finishedAt: new Date() })
      .where(eq(verificationRuns.id, runId));

  // Claim the run. A second delivery of the same job finds nothing to claim.
  const [run] = await db
    .update(verificationRuns)
    .set({ status: 'running' })
    .where(and(eq(verificationRuns.id, runId), eq(verificationRuns.status, 'queued')))
    .returning({ submissionId: verificationRuns.submissionId });
  if (!run) return;

  try {
    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, run.submissionId));
    if (!submission) throw new Error('The submission no longer exists.');

    const [config] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!config?.labRepoPath) {
      await finish({
        status: 'error',
        error: 'Set the path of your lab repository on the Settings page, then submit again.',
      });
      return;
    }

    const result = await deps.runOnBridge({
      taskId: submission.taskId,
      repoPath: config.labRepoPath,
      ...(submission.commitSha ? { commitSha: submission.commitSha } : {}),
    });

    await db.transaction(async (tx) => {
      if (result.commitSha && result.commitSha !== submission.commitSha) {
        // Record exactly which commit was checked, also when "latest" was submitted.
        await tx
          .update(submissions)
          .set({ commitSha: result.commitSha })
          .where(eq(submissions.id, submission.id));
      }
      if (result.results.length > 0) {
        await tx.insert(checkResults).values(
          result.results.map((r, position) => ({
            runId,
            criterionId: r.criterionId,
            position,
            title: r.title,
            passed: r.passed,
            log: r.log,
          })),
        );
      }
      await tx
        .update(verificationRuns)
        .set({
          status: result.status,
          error: result.message,
          rawOutput: result.log,
          durationMs: result.durationMs,
          finishedAt: new Date(),
        })
        .where(eq(verificationRuns.id, runId));
    });
  } catch (error) {
    if (error instanceof BridgeUnavailableError) {
      await finish({
        status: 'not_run',
        error:
          'The host bridge is not running, so the automated checks were skipped. Start it with "pnpm dev" and submit again.',
      });
      return;
    }
    await finish({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Fails check runs that an earlier worker left unfinished.
 *
 * The queue does not retry a job, so a run that was "running" when the worker
 * stopped (a crash, a closed laptop) would stay that way: the task page would
 * poll for ever and the submission could never be reviewed. Call this once at
 * start-up, before taking jobs. It assumes a single worker, which is how the
 * platform runs.
 */
export async function failInterruptedRuns(db: Database): Promise<number> {
  const failed = await db
    .update(verificationRuns)
    .set({
      status: 'error',
      error: 'The checker restarted while this run was in progress. Submit again.',
      finishedAt: new Date(),
    })
    .where(and(eq(verificationRuns.stage, 'checks'), eq(verificationRuns.status, 'running')))
    .returning({ id: verificationRuns.id });
  return failed.length;
}
