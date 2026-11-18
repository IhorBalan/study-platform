import { randomBytes } from 'node:crypto';
import type { Config } from './config.js';
import { exec } from './exec.js';

/** Practice services a task may ask for, by the name used in `task.yaml`. */
const CONTAINERS = {
  postgres: 'study-lab-postgres-1',
  valkey: 'study-lab-valkey-1',
  aws: 'study-lab-aws-1',
  mailpit: 'study-lab-mailpit-1',
} as const;
type ServiceName = keyof typeof CONTAINERS;

export interface PreparedServices {
  /** Environment variables the check suite and the submission read. */
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}

async function isRunning(config: Config, container: string): Promise<boolean> {
  const result = await exec(
    config.DOCKER_BIN,
    ['inspect', '--format', '{{.State.Running}}', container],
    { timeoutMs: 10_000 },
  );
  return result.code === 0 && result.stdout.trim() === 'true';
}

/**
 * Checks that the services a task needs are up and gives the run its own
 * corner of each, so a check can create and drop what it likes without
 * touching the learner's own practice data.
 *
 * Returns a message for the learner when something is missing.
 */
export async function prepareServices(
  config: Config,
  services: string[],
): Promise<PreparedServices | string> {
  const runId = randomBytes(6).toString('hex');
  const env: Record<string, string> = { CHECK_RUN_ID: runId };
  const cleanups: (() => Promise<unknown>)[] = [];

  const unknown = services.filter((s) => !(s in CONTAINERS));
  if (unknown.length > 0) {
    return `This task asks for a practice service the platform does not know: ${unknown.join(', ')}.`;
  }
  const missing: string[] = [];
  for (const service of services as ServiceName[]) {
    if (!(await isRunning(config, CONTAINERS[service]))) missing.push(service);
  }
  if (missing.length > 0) {
    return `This task needs the ${missing.join(' and ')} practice service${missing.length > 1 ? 's' : ''}. Start with "pnpm lab up ${missing.join(' ')}" and submit again.`;
  }

  for (const service of services as ServiceName[]) {
    switch (service) {
      case 'postgres': {
        // A fresh database per run. The name is generated here, never taken from a request.
        const database = `check_${runId}`;
        const container = CONTAINERS.postgres;
        const created = await exec(
          config.DOCKER_BIN,
          ['exec', container, 'createdb', '-U', 'lab', database],
          { timeoutMs: 20_000 },
        );
        if (created.code !== 0) {
          return `Could not create a database for the checks: ${created.stderr.trim().slice(0, 300)}`;
        }
        cleanups.push(() =>
          exec(
            config.DOCKER_BIN,
            ['exec', container, 'dropdb', '-U', 'lab', '--force', '--if-exists', database],
            { timeoutMs: 20_000 },
          ),
        );
        env.DATABASE_URL = `postgres://lab:lab@postgres:5432/${database}`;
        break;
      }
      case 'valkey':
        env.VALKEY_URL = 'redis://valkey:6379';
        env.VALKEY_KEY_PREFIX = `check_${runId}:`;
        break;
      case 'aws':
        env.AWS_ENDPOINT_URL = 'http://aws:4566';
        env.AWS_REGION = 'us-east-1';
        // The emulator accepts any credentials; these are not secrets.
        env.AWS_ACCESS_KEY_ID = 'test';
        env.AWS_SECRET_ACCESS_KEY = 'test';
        env.AWS_RESOURCE_PREFIX = `check-${runId}-`;
        break;
      case 'mailpit':
        env.SMTP_HOST = 'mailpit';
        env.SMTP_PORT = '1025';
        env.MAILPIT_URL = 'http://mailpit:8025';
        break;
    }
  }

  return {
    env,
    cleanup: async () => {
      for (const cleanup of cleanups) await cleanup().catch(() => undefined);
    },
  };
}
