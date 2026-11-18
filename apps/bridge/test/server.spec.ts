import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { loadCurriculum } from '@study/curriculum';
import type { RunChecksResponse } from '@study/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createBridgeServer } from '../src/server.js';

const SECRET = 'test-secret-that-is-long-enough-123';
const curriculumDir = path.resolve(import.meta.dirname, '../../api/test/fixtures/curriculum');

describe('bridge server', () => {
  let base: string;
  let close: () => Promise<void>;
  const calls: unknown[] = [];
  let healthReads = 0;
  let reviewsRunning = 0;
  let mostReviewsAtOnce = 0;

  beforeAll(async () => {
    const curriculum = await loadCurriculum(curriculumDir);
    const config = loadConfig({ BRIDGE_SECRET: SECRET, CURRICULUM_DIR: curriculumDir });
    const fake: RunChecksResponse = {
      status: 'passed',
      message: null,
      commitSha: 'a'.repeat(40),
      results: [],
      log: '',
      durationMs: 1,
    };
    const server = createBridgeServer({
      config,
      curriculum,
      health: async () => {
        healthReads += 1;
        return { status: 'ok', docker: true, runners: ['node'], claude: false, lastBackupAt: null };
      },
      review: async () => {
        reviewsRunning += 1;
        mostReviewsAtOnce = Math.max(mostReviewsAtOnce, reviewsRunning);
        await new Promise((resolve) => setTimeout(resolve, 30));
        reviewsRunning -= 1;
        return {
          status: 'ok',
          message: null,
          output: 'fine',
          model: null,
          costUsd: null,
          durationMs: 1,
        };
      },
      run: async (_config, task, request) => {
        calls.push({ task: task.id, request });
        return fake;
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });

  afterAll(() => close());

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/checks/run`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'application/json',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('rejects a request without the secret', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong secret of the same length', async () => {
    const res = await post({}, { authorization: `Bearer ${'x'.repeat(SECRET.length)}` });
    expect(res.status).toBe(401);
  });

  it('rejects a request addressed to another host name', async () => {
    // fetch() does not allow overriding Host, so use node:http directly.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${base}/health`,
        { headers: { host: 'evil.example', authorization: `Bearer ${SECRET}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('rejects a request that comes from a web page', async () => {
    const res = await post({}, { origin: 'http://localhost:5173' });
    expect(res.status).toBe(403);
  });

  it('rejects a body that is not valid JSON', async () => {
    const res = await post('{nope');
    expect(res.status).toBe(400);
  });

  it('rejects a task id that could escape the curriculum folder', async () => {
    const res = await post({ taskId: '../../etc', repoPath: '/tmp/lab' });
    expect(res.status).toBe(400);
  });

  it('rejects a commit id that is not hexadecimal', async () => {
    const res = await post({
      taskId: 'm00-demo/t02-code',
      repoPath: '/tmp/lab',
      commitSha: '--upload-pack=x',
    });
    expect(res.status).toBe(400);
  });

  it('answers 404 for a task that is not in the curriculum', async () => {
    const res = await post({ taskId: 'm99-none/t01-none', repoPath: '/tmp/lab' });
    expect(res.status).toBe(404);
  });

  it('runs the checks for a known task', async () => {
    const taskId = (await loadCurriculum(curriculumDir)).modules[0]!.tasks[0]!.id;
    const res = await post({ taskId, repoPath: '/tmp/lab' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as RunChecksResponse).status).toBe('passed');
    expect(calls).toContainEqual({ task: taskId, request: { taskId, repoPath: '/tmp/lab' } });
  });

  it('reuses a health answer for a short while', async () => {
    const get = () => fetch(`${base}/health`, { headers: { authorization: `Bearer ${SECRET}` } });
    const [first, second] = await Promise.all([get(), get()]);
    expect(await first.json()).toMatchObject({ status: 'ok', runners: ['node'] });
    expect(second.status).toBe(200);
    await get();
    expect(healthReads).toBe(1);
  });

  it('runs one review at a time', async () => {
    const review = () =>
      fetch(`${base}/review/run`, {
        method: 'POST',
        headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: 'm00-demo/t01-explain', prompt: 'Review this.' }),
      });
    const replies = await Promise.all([review(), review(), review()]);
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(mostReviewsAtOnce).toBe(1);
  });
});
