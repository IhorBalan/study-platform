import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { MAX_ROUNDS } from './hash.mjs';

const WORKER_URL = new URL('./hash-worker.mjs', import.meta.url);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseHashQuery(searchParams) {
  const input = searchParams.get('input');
  const rounds = Number(searchParams.get('rounds'));
  if (input === null) return { error: 'Query parameter "input" is required.' };
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    return { error: `Query parameter "rounds" must be an integer from 1 to ${MAX_ROUNDS}.` };
  }
  return { input, rounds };
}

/**
 * Runs the hash in a worker thread, so the main thread only waits for a message.
 * Aborting the signal terminates the worker.
 */
function hashInWorker(input, rounds, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: { input, rounds } });
    const onAbort = () => {
      worker.terminate();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = (fn) => (value) => {
      signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    worker.once('message', settle(resolve));
    worker.once('error', settle(reject));
    worker.once('exit', settle((code) => reject(new Error(`hash worker exited with code ${code}`))));
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { status: 'ok' });
    }

    if (req.method === 'GET' && pathname === '/hash') {
      const query = parseHashQuery(searchParams);
      if (query.error) return sendJson(res, 400, { error: query.error });

      // Stop the work if the client goes away before the answer is ready.
      const controller = new AbortController();
      res.once('close', () => controller.abort(new Error('client disconnected')));

      try {
        const hash = await hashInWorker(query.input, query.rounds, controller.signal);
        return sendJson(res, 200, { input: query.input, rounds: query.rounds, hash });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        return sendJson(res, 500, { error: 'Could not compute the hash.' });
      }
    }

    return sendJson(res, 404, { error: 'Not found' });
  });
}
