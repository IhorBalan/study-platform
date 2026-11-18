import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');

let loaded;
async function loadMapLimit() {
  loaded ??= import(pathToFileURL(path.join(submissionDir, 'map-limit.mjs')).href);
  const mod = await loaded;
  assert.equal(typeof mod.mapLimit, 'function', 'map-limit.mjs must export a function named mapLimit');
  return mod.mapLimit;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lets every pending microtask and immediate run, a few times over. */
async function settleLoop() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Resolves to { state: 'fulfilled' | 'rejected' | 'pending' } without waiting for the promise. */
async function peek(promise) {
  // Attach the handlers before yielding, so an early rejection is never unhandled.
  const observed = promise.then(
    (value) => ({ state: 'fulfilled', value }),
    (error) => ({ state: 'rejected', error }),
  );
  await settleLoop();
  const pending = Symbol('pending');
  const outcome = await Promise.race([
    observed,
    new Promise((resolve) => setImmediate(() => resolve(pending))),
  ]);
  return outcome === pending ? { state: 'pending' } : outcome;
}

/**
 * An fn whose calls are finished by the test. `started` lists the indexes in
 * the order fn was called; `resolve(i, v)` and `reject(i, e)` finish call i.
 */
function manualTasks() {
  const started = [];
  const deferred = new Map();
  const fn = (item, index) => {
    started.push(index);
    return new Promise((resolve, reject) => deferred.set(index, { resolve, reject }));
  };
  const pick = (index) => {
    const entry = deferred.get(index);
    assert.ok(entry, `test bug or scheduling error: call for index ${index} has not started`);
    return entry;
  };
  return {
    fn,
    started,
    resolve: (index, value) => pick(index).resolve(value),
    reject: (index, error) => pick(index).reject(error),
  };
}

/** Fails the test if the callback leaves a rejection unhandled. */
async function withoutUnhandledRejections(run) {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await run();
    await settleLoop();
    await sleep(20);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.equal(
    unhandled.length,
    0,
    `a call that was still in flight rejected later and nothing handled it: ${String(unhandled[0])}`,
  );
}

/** Calls mapLimit and normalises a synchronous throw into a rejected promise. */
function call(mapLimit, ...args) {
  try {
    return Promise.resolve(mapLimit(...args));
  } catch (error) {
    return Promise.reject(error);
  }
}

test('ordered-results: results are in input order and fn receives the item and its index', async () => {
  const mapLimit = await loadMapLimit();

  const items = ['a', 'b', 'c', 'd', 'e', 'f'];
  const delays = [30, 5, 20, 1, 10, 15];
  const seen = [];
  const result = await call(mapLimit, items, 3, async (item, index) => {
    seen.push([item, index]);
    await sleep(delays[index]);
    return `${item}${index}`;
  });
  assert.deepEqual(
    result,
    ['a0', 'b1', 'c2', 'd3', 'e4', 'f5'],
    'results must be in input order even when later items finish first',
  );
  assert.deepEqual(
    [...seen].sort((x, y) => x[1] - y[1]),
    items.map((item, index) => [item, index]),
    'fn must be called exactly once per item, with (item, index)',
  );

  const sync = await call(mapLimit, [1, 2, 3], 2, (n) => n * 2);
  assert.deepEqual(sync, [2, 4, 6], 'fn may return a plain value instead of a promise');

  let calls = 0;
  const empty = await call(mapLimit, [], 4, () => {
    calls += 1;
  });
  assert.deepEqual(empty, [], 'an empty items array must resolve to []');
  assert.equal(calls, 0, 'fn must not be called for an empty items array');

  const falsy = await call(mapLimit, [0, 1, 2], 1, async (n) => (n === 1 ? undefined : n));
  assert.deepEqual(falsy, [0, undefined, 2], 'falsy results such as 0 and undefined must be kept in place');
});

test('respects-limit: never more than limit calls are in flight and the limit is fully used', async () => {
  const mapLimit = await loadMapLimit();

  async function measure(count, limit) {
    let inFlight = 0;
    let max = 0;
    const items = Array.from({ length: count }, (_, i) => i);
    const result = await call(mapLimit, items, limit, async (n) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await sleep(1 + ((n * 7) % 9));
      inFlight -= 1;
      return n;
    });
    assert.deepEqual(result, items, `with ${count} items and limit ${limit} the results were wrong or out of order`);
    return max;
  }

  for (const [count, limit, expected] of [
    [24, 3, 3],
    [10, 1, 1],
    [12, 5, 5],
    [2, 10, 2],
  ]) {
    const max = await measure(count, limit);
    assert.ok(max <= limit, `with ${count} items and limit ${limit}, ${max} calls were in flight at once`);
    assert.equal(
      max,
      expected,
      `with ${count} items and limit ${limit}, at most ${max} calls ran at once; expected the run to reach ${expected}`,
    );
  }
});

test('refills-slots: a finished call frees its slot at once instead of waiting for a whole batch', async () => {
  const mapLimit = await loadMapLimit();
  const tasks = manualTasks();
  const promise = call(mapLimit, ['a', 'b', 'c', 'd'], 2, tasks.fn);
  promise.catch(() => {});

  await settleLoop();
  assert.deepEqual(tasks.started, [0, 1], `with limit 2, exactly items 0 and 1 should start first; started: [${tasks.started}]`);

  // Item 0 stays in flight the whole time. Item 1 finishes, so its slot must be reused.
  tasks.resolve(1, 'B');
  await settleLoop();
  assert.deepEqual(
    tasks.started,
    [0, 1, 2],
    `after item 1 finished while item 0 was still running, item 2 should have started; started: [${tasks.started}]`,
  );
  tasks.resolve(2, 'C');
  await settleLoop();
  assert.deepEqual(
    tasks.started,
    [0, 1, 2, 3],
    `after item 2 finished while item 0 was still running, item 3 should have started; started: [${tasks.started}]`,
  );

  assert.equal((await peek(promise)).state, 'pending', 'the promise must stay pending while calls are in flight');
  tasks.resolve(3, 'D');
  tasks.resolve(0, 'A');
  const outcome = await peek(promise);
  assert.equal(outcome.state, 'fulfilled', `after every call finished the promise should be fulfilled, but it is ${outcome.state}`);
  assert.deepEqual(outcome.value, ['A', 'B', 'C', 'D'], 'results must be in input order');
});

test('fail-fast: the first failure rejects immediately and no further calls start', async () => {
  const mapLimit = await loadMapLimit();

  await withoutUnhandledRejections(async () => {
    const tasks = manualTasks();
    const boom = new Error('boom');
    const promise = call(mapLimit, [0, 1, 2, 3, 4, 5], 2, tasks.fn);
    promise.catch(() => {});

    await settleLoop();
    tasks.reject(1, boom);
    const outcome = await peek(promise);
    assert.equal(
      outcome.state,
      'rejected',
      `item 1 failed while item 0 was still in flight: the promise should reject at once, but it is ${outcome.state}`,
    );
    assert.equal(outcome.error, boom, 'the promise must reject with the same error object that fn rejected with');
    assert.deepEqual(tasks.started, [0, 1], `no new call may start after a failure; started: [${tasks.started}]`);

    // The call that was in flight finishes, then another late one fails: nothing may restart or leak.
    tasks.resolve(0, 'late');
    await settleLoop();
    assert.deepEqual(tasks.started, [0, 1], `a call finishing after the failure must not start new ones; started: [${tasks.started}]`);
  });

  await withoutUnhandledRejections(async () => {
    const tasks = manualTasks();
    const first = new Error('first');
    const promise = call(mapLimit, [0, 1, 2], 2, tasks.fn);
    promise.catch(() => {});
    await settleLoop();
    tasks.reject(0, first);
    await settleLoop();
    tasks.reject(1, new Error('second, after the promise already rejected'));
    const outcome = await peek(promise);
    assert.equal(outcome.error, first, 'the promise must reject with the first failure');
  });

  const thrown = new Error('thrown synchronously');
  let calls = 0;
  const outcome = await peek(
    call(mapLimit, [0, 1, 2, 3], 1, (n) => {
      calls += 1;
      if (n === 1) throw thrown;
      return n;
    }),
  );
  assert.equal(outcome.state, 'rejected', `fn threw synchronously for item 1: the promise should reject, but it is ${outcome.state}`);
  assert.equal(outcome.error, thrown, 'a synchronous throw from fn must become the rejection reason');
  assert.equal(calls, 2, `after fn threw for item 1, no further items may start; fn was called ${calls} times`);
});

test('abort-in-flight: aborting the signal rejects with its reason and no further calls start', async () => {
  const mapLimit = await loadMapLimit();

  await withoutUnhandledRejections(async () => {
    const tasks = manualTasks();
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    const promise = call(mapLimit, [0, 1, 2, 3, 4, 5], 2, tasks.fn, { signal: controller.signal });
    promise.catch(() => {});

    await settleLoop();
    tasks.resolve(0, 'zero');
    await settleLoop();
    assert.deepEqual(tasks.started, [0, 1, 2], `before the abort, items 0, 1 and 2 should have started; started: [${tasks.started}]`);

    controller.abort(reason);
    const outcome = await peek(promise);
    assert.equal(
      outcome.state,
      'rejected',
      `the signal was aborted while calls were in flight: the promise should reject at once, but it is ${outcome.state}`,
    );
    assert.equal(outcome.error, reason, 'the promise must reject with signal.reason');

    tasks.resolve(1, 'one');
    tasks.reject(2, new Error('late failure after the abort'));
    await settleLoop();
    assert.deepEqual(tasks.started, [0, 1, 2], `no new call may start after the abort; started: [${tasks.started}]`);
  });

  // A signal that never aborts must not get in the way.
  const quiet = new AbortController();
  const result = await call(mapLimit, [1, 2, 3], 2, async (n) => n + 1, { signal: quiet.signal });
  assert.deepEqual(result, [2, 3, 4], 'with a signal that is never aborted the result must be the normal one');
});

test('already-aborted: an already aborted signal rejects without calling fn', async () => {
  const mapLimit = await loadMapLimit();
  const reason = new Error('too late');
  let calls = 0;
  const outcome = await peek(
    call(
      mapLimit,
      [1, 2, 3],
      2,
      async (n) => {
        calls += 1;
        return n;
      },
      { signal: AbortSignal.abort(reason) },
    ),
  );
  assert.equal(outcome.state, 'rejected', `with an already aborted signal the promise should reject, but it is ${outcome.state}`);
  assert.equal(outcome.error, reason, 'the promise must reject with signal.reason');
  assert.equal(calls, 0, `fn must not be called when the signal is already aborted; it was called ${calls} time(s)`);
});

test('invalid-limit: a limit that is not a positive integer rejects with a RangeError', async () => {
  const mapLimit = await loadMapLimit();
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2', undefined]) {
    let calls = 0;
    const outcome = await peek(
      call(mapLimit, [1, 2, 3], limit, async (n) => {
        calls += 1;
        return n;
      }),
    );
    const shown = typeof limit === 'string' ? `"${limit}"` : String(limit);
    assert.equal(outcome.state, 'rejected', `limit ${shown}: the promise should reject, but it is ${outcome.state}`);
    assert.ok(
      outcome.error instanceof RangeError,
      `limit ${shown}: expected a RangeError, got ${outcome.error?.constructor?.name ?? typeof outcome.error}: ${outcome.error?.message ?? outcome.error}`,
    );
    assert.equal(calls, 0, `limit ${shown}: fn must not be called; it was called ${calls} time(s)`);
  }
});
