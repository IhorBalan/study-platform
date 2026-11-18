import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Curriculum, LoadedTask } from '@study/curriculum';
import { RunChecksRequest, type BridgeHealth, type RunChecksResponse } from '@study/shared';
import { dockerAvailable, imageExists, runChecks, runnerImage } from './checks.js';
import type { Config } from './config.js';

const MAX_BODY_BYTES = 64 * 1024;
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
}

/**
 * The bridge accepts a fixed set of operations. It never takes a command, an
 * image name or a mount path from a request: those come from the curriculum.
 */
export function createBridgeServer({ config, curriculum, run = runChecks }: BridgeDeps): Server {
  const tasks = new Map<string, LoadedTask>(
    curriculum.modules.flatMap((m) => m.tasks.map((t) => [t.id, t] as const)),
  );

  // One sandbox at a time keeps memory use predictable on a laptop.
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!ALLOWED_HOSTS.has(host)) return problem(res, 403, 'Forbidden');
    if (!authorised(req, config.BRIDGE_SECRET)) return problem(res, 401, 'Unauthorized');

    const url = new URL(req.url ?? '/', 'http://bridge');

    if (req.method === 'GET' && url.pathname === '/health') {
      const docker = await dockerAvailable(config);
      const runners: string[] = [];
      if (docker) {
        for (const runner of ['node', 'nest'] as const) {
          if (await imageExists(config, runnerImage(runner))) runners.push(runner);
        }
      }
      const body: BridgeHealth = { status: 'ok', docker, runners };
      return send(res, 200, body);
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
