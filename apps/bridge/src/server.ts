import { lastBackupAt } from './backups.js';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Curriculum, LoadedTask } from '@study/curriculum';
import {
  RunChecksRequest,
  RunReviewRequest,
  type BridgeHealth,
  type RunChecksResponse,
  type RunReviewResponse,
} from '@study/shared';
import { dockerAvailable, imageExists, runChecks, runnerImage } from './checks.js';
import type { Config } from './config.js';
import { claudeAvailable, runReview } from './review.js';

const MAX_BODY_BYTES = 512 * 1024;
/** Names the bridge answers to. Anything else is a page trying DNS rebinding. */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

function problem(res: ServerResponse, status: number, title: string, detail?: string): void {
  send(res, status, { type: 'about:blank', title, status, detail });
}

function authorised(req: IncomingMessage, secret: string): boolean {
  const header = req.headers.authorization ?? '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('too-large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export interface BridgeDeps {
  config: Config;
  curriculum: Curriculum;
  /** Replaceable in tests. */
  run?: typeof runChecks;
  review?: typeof runReview;
  health?: typeof readHealth;
}

/** How long a health answer is reused. */
const HEALTH_TTL_MS = 15_000;

/** What the host can do right now: Docker, the runner images, the Claude CLI, the last backup. */
async function readHealth(config: Config): Promise<BridgeHealth> {
  const docker = await dockerAvailable(config);
  const runners: string[] = [];
  if (docker) {
    for (const runner of ['node', 'nest'] as const) {
      if (await imageExists(config, runnerImage(runner))) runners.push(runner);
    }
  }
  return {
    status: 'ok',
    docker,
    runners,
    claude: await claudeAvailable(config),
    lastBackupAt: await lastBackupAt(config.BACKUP_DIR),
  };
}

/**
 * The bridge accepts a fixed set of operations. It never takes a command, an
 * image name or a mount path from a request: those come from the curriculum.
 */
export function createBridgeServer({
  config,
  curriculum,
  run = runChecks,
  review = runReview,
  health = readHealth,
}: BridgeDeps): Server {
  const tasks = new Map<string, LoadedTask>(
    curriculum.modules.flatMap((m) => m.tasks.map((t) => [t.id, t] as const)),
  );

  /** Runs jobs one after another, in the order they arrive. */
  const oneAtATime = () => {
    let queue: Promise<unknown> = Promise.resolve();
    return <T>(job: () => Promise<T>): Promise<T> => {
      const next = queue.then(job, job);
      queue = next.catch(() => undefined);
      return next;
    };
  };
  // One sandbox at a time keeps memory use predictable on a laptop.
  const inTurn = oneAtATime();
  // One review at a time too: each starts a Claude process, and several at once
  // would compete for the same account limits. A second request is refused
  // instead of queued: the API stops waiting after a few minutes, and a review
  // that started after that would spend the learner's plan on a result nobody stores.
  let reviewRunning = false;

  // The web app asks for the health every 30 seconds per open task page, and each
  // answer costs four child processes. A short memory keeps that to one set.
  let healthAt = 0;
  let healthValue: Promise<BridgeHealth> | null = null;
  const cachedHealth = (): Promise<BridgeHealth> => {
    if (!healthValue || Date.now() - healthAt > HEALTH_TTL_MS) {
      healthAt = Date.now();
      healthValue = health(config).catch((error: unknown) => {
        healthValue = null;
        throw error;
      });
    }
    return healthValue;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!ALLOWED_HOSTS.has(host)) return problem(res, 403, 'Forbidden');
    // Only browsers send Origin. The worker and the API never do, so any request
    // carrying one comes from a web page and is refused.
    if (req.headers.origin !== undefined) return problem(res, 403, 'Forbidden');
    if (!authorised(req, config.BRIDGE_SECRET)) return problem(res, 401, 'Unauthorized');

    const url = new URL(req.url ?? '/', 'http://bridge');

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, await cachedHealth());
    }

    if (req.method === 'POST' && url.pathname === '/checks/run') {
      let json: unknown;
      try {
        json = await readJson(req);
      } catch (error) {
        return error instanceof Error && error.message === 'too-large'
          ? problem(res, 413, 'Payload Too Large')
          : problem(res, 400, 'Bad Request', 'The body is not valid JSON.');
      }
      const parsed = RunChecksRequest.safeParse(json);
      if (!parsed.success) {
        return problem(res, 400, 'Bad Request', parsed.error.issues[0]?.message);
      }
      const task = tasks.get(parsed.data.taskId);
      if (!task) return problem(res, 404, 'Not Found', `Unknown task ${parsed.data.taskId}.`);
      const result: RunChecksResponse = await inTurn(() => run(config, task, parsed.data));
      return send(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/review/run') {
      let json: unknown;
      try {
        json = await readJson(req);
      } catch (error) {
        return error instanceof Error && error.message === 'too-large'
          ? problem(res, 413, 'Payload Too Large')
          : problem(res, 400, 'Bad Request', 'The body is not valid JSON.');
      }
      const parsed = RunReviewRequest.safeParse(json);
      if (!parsed.success) {
        return problem(res, 400, 'Bad Request', parsed.error.issues[0]?.message);
      }
      const task = tasks.get(parsed.data.taskId);
      if (!task) return problem(res, 404, 'Not Found', `Unknown task ${parsed.data.taskId}.`);
      if (reviewRunning) return problem(res, 409, 'Conflict', 'Another review is running');
      reviewRunning = true;
      try {
        const result: RunReviewResponse = await review(config, task, parsed.data);
        return send(res, 200, result);
      } finally {
        reviewRunning = false;
      }
    }

    return problem(res, 404, 'Not Found');
  };

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error('[bridge] request failed:', error);
      if (!res.headersSent) problem(res, 500, 'Internal Server Error');
      else res.end();
    });
  });
}
