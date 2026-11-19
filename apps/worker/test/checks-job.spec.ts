import { createDatabase, runMigrations, schema, type DatabaseHandle } from '@study/db';
import type { RunChecksResponse } from '@study/shared';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BridgeUnavailableError, type RunChecksOnBridge } from '../src/bridge-client.js';
import { failInterruptedRuns, processChecksJob, resendWaitingRuns } from '../src/checks-job.js';

const { modules, tasks, submissions, verificationRuns, checkResults, settings } = schema;
const TASK = 'm00-demo/t02-code';
const SHA = 'b'.repeat(40);

describe('checks job (real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let handle: DatabaseHandle;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine').start();
    handle = createDatabase(container.getConnectionUri());
    await runMigrations(handle.db);
    await handle.db
      .insert(modules)
      .values({ id: 'm00-demo', title: 'Demo', position: 0, kind: 'core', effort: 'S' });
    await handle.db.insert(tasks).values({
      id: TASK,
      moduleId: 'm00-demo',
      title: 'Code',
      position: 2,
      submissionType: 'repo',
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
    await container?.stop();
  });

  async function queueRun(commitSha: string | null = null): Promise<string> {
    const [submission] = await handle.db
      .insert(submissions)
      .values({ taskId: TASK, type: 'repo', folder: TASK, commitSha })
      .returning();
    const [run] = await handle.db
      .insert(verificationRuns)
      .values({ submissionId: submission!.id, stage: 'checks' })
      .returning();
    return run!.id;
  }

  const loadRun = async (id: string) =>
    (await handle.db.select().from(verificationRuns).where(eq(verificationRuns.id, id)))[0]!;

  const passing: RunChecksResponse = {
    status: 'failed',
    message: null,
    commitSha: SHA,
    results: [
      { criterionId: 'starts', title: 'It starts', passed: true, log: null },
      { criterionId: 'answers', title: 'It answers', passed: false, log: 'expected 200, got 500' },
    ],
    log: 'tail of the output',
    durationMs: 1234,
  };

  it('asks for the lab repository path when it is not set', async () => {
    const runId = await queueRun();
    let called = false;
    await processChecksJob(
      {
        db: handle.db,
        runOnBridge: async () => {
          called = true;
          return passing;
        },
      },
      runId,
    );
    const run = await loadRun(runId);
    expect(run.status).toBe('error');
    expect(run.error).toContain('Settings');
    expect(called).toBe(false);
  });

  it('stores each criterion and the checked commit', async () => {
    await handle.db
      .insert(settings)
      .values({ id: 1, labRepoPath: '/lab' })
      .onConflictDoUpdate({
        target: settings.id,
        set: { labRepoPath: '/lab' },
      });
    const runId = await queueRun();
    const requests: unknown[] = [];
    const runOnBridge: RunChecksOnBridge = async (request) => {
      requests.push(request);
      return passing;
    };
    await processChecksJob({ db: handle.db, runOnBridge }, runId);

    expect(requests).toEqual([{ taskId: TASK, repoPath: '/lab' }]);
    const run = await loadRun(runId);
    expect(run).toMatchObject({
      status: 'failed',
      durationMs: 1234,
      rawOutput: 'tail of the output',
    });
    expect(run.finishedAt).toBeInstanceOf(Date);

    const rows = await handle.db
      .select()
      .from(checkResults)
      .where(eq(checkResults.runId, runId))
      .orderBy(checkResults.position);
    expect(rows.map((r) => [r.criterionId, r.passed])).toEqual([
      ['starts', true],
      ['answers', false],
    ]);
    const [submission] = await handle.db
      .select()
      .from(submissions)
      .where(eq(submissions.id, run.submissionId));
    expect(submission!.commitSha).toBe(SHA);
  });

  it('marks the run as not run when the bridge is offline', async () => {
    const runId = await queueRun(SHA);
    await processChecksJob(
      {
        db: handle.db,
        runOnBridge: async () => {
          throw new BridgeUnavailableError('connect ECONNREFUSED');
        },
      },
      runId,
    );
    const run = await loadRun(runId);
    expect(run.status).toBe('not_run');
    expect(run.error).toContain('bridge is not running');
  });

  it('does not process the same run twice', async () => {
    const runId = await queueRun(SHA);
    let calls = 0;
    const runOnBridge: RunChecksOnBridge = async () => {
      calls += 1;
      return { ...passing, status: 'passed', results: [] };
    };
    await processChecksJob({ db: handle.db, runOnBridge }, runId);
    await processChecksJob({ db: handle.db, runOnBridge }, runId);
    expect(calls).toBe(1);
    expect((await loadRun(runId)).status).toBe('passed');
  });

  it('fails runs left running by a stopped worker and leaves the rest alone', async () => {
    const interrupted = await queueRun();
    const queued = await queueRun();
    const review = await queueRun();
    const set = (id: string, values: Partial<typeof verificationRuns.$inferInsert>) =>
      handle.db.update(verificationRuns).set(values).where(eq(verificationRuns.id, id));
    await set(interrupted, { status: 'running' });
    await set(review, { stage: 'review', status: 'running' });

    expect(await failInterruptedRuns(handle.db)).toBe(1);

    const failed = await loadRun(interrupted);
    expect(failed.status).toBe('error');
    expect(failed.error).toContain('Submit again');
    expect(failed.finishedAt).not.toBeNull();
    expect((await loadRun(queued)).status).toBe('queued');
    expect((await loadRun(review)).status).toBe('running');

    // Nothing is left to fail on the next start.
    expect(await failInterruptedRuns(handle.db)).toBe(0);
  });

  it('sends a job again for every run that is still waiting, and only for those', async () => {
    const set = (id: string, values: Partial<typeof verificationRuns.$inferInsert>) =>
      handle.db.update(verificationRuns).set(values).where(eq(verificationRuns.id, id));
    // Earlier tests may have left runs waiting: settle them first.
    await handle.db
      .update(verificationRuns)
      .set({ status: 'error' })
      .where(eq(verificationRuns.status, 'queued'));
    const first = await queueRun();
    const second = await queueRun();
    const done = await queueRun();
    const review = await queueRun();
    await set(done, { status: 'passed' });
    await set(review, { stage: 'review' });

    const sent: string[] = [];
    const count = await resendWaitingRuns(handle.db, async (runId) => {
      sent.push(runId);
    });
    expect(count).toBe(2);
    expect(sent.toSorted()).toEqual([first, second].toSorted());

    // A run that is sent twice is still checked once.
    let calls = 0;
    const runOnBridge: RunChecksOnBridge = async () => {
      calls++;
      return passing;
    };
    await handle.db
      .insert(settings)
      .values({ id: 1, labRepoPath: '/lab' })
      .onConflictDoUpdate({ target: settings.id, set: { labRepoPath: '/lab' } });
    await processChecksJob({ db: handle.db, runOnBridge }, first);
    await processChecksJob({ db: handle.db, runOnBridge }, first);
    expect(calls).toBe(1);
  });
});
