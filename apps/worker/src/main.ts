import { createDatabase } from '@study/db';
import { CHECKS_QUEUE, ChecksJob } from '@study/shared';
import { PgBoss } from 'pg-boss';
import { createBridgeClient } from './bridge-client.js';
import { failInterruptedRuns, processChecksJob, resendWaitingRuns } from './checks-job.js';
import { loadConfig } from './config.js';
import { onceMigrated } from './wait-for-schema.js';

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL, {
  onPoolError: (error) => console.warn('[worker] database connection lost:', error.message),
});
const runOnBridge = createBridgeClient(config);

const boss = new PgBoss(config.DATABASE_URL);
boss.on('error', (error) => console.warn('[worker] queue error:', error.message));
await boss.start();
await boss.createQueue(CHECKS_QUEUE);

// On a new install the API may still be creating the tables.
const interrupted = await onceMigrated(() => failInterruptedRuns(db), {
  onWaiting: () => console.log('[worker] waiting for the API to set up the database'),
});
if (interrupted > 0) {
  console.log(`[worker] marked ${interrupted} run(s) interrupted by a restart as failed`);
}

// The same options the API uses when it queues a run.
const resent = await resendWaitingRuns(db, (runId) =>
  boss.send(CHECKS_QUEUE, { runId } satisfies ChecksJob, { retryLimit: 0 }),
);
if (resent > 0) console.log(`[worker] queued ${resent} waiting run(s) again`);

await boss.work(CHECKS_QUEUE, async (jobs) => {
  for (const job of jobs) {
    const parsed = ChecksJob.safeParse(job.data);
    if (!parsed.success) {
      console.warn('[worker] dropped a malformed job', job.id);
      continue;
    }
    await processChecksJob({ db, runOnBridge }, parsed.data.runId);
  }
});
console.log('[worker] waiting for check jobs');

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    // Let a running check finish, then release the connections.
    void boss
      .stop({ graceful: true, timeout: 30_000 })
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
}
