import { describe, expect, it } from 'vitest';
import { onceMigrated } from '../src/wait-for-schema.js';

const noSleep = { sleep: () => Promise.resolve() };
const missingTable = () =>
  // The shape the query builder throws: the driver's error is the cause.
  Object.assign(new Error('Failed query'), {
    cause: Object.assign(new Error('x'), { code: '42P01' }),
  });

describe('onceMigrated', () => {
  it('returns at once when the tables are there', async () => {
    let calls = 0;
    expect(await onceMigrated(async () => ++calls, noSleep)).toBe(1);
  });

  it('tries again while a table is missing, and says so once', async () => {
    let calls = 0;
    let notices = 0;
    const result = await onceMigrated(
      async () => {
        calls += 1;
        if (calls < 4) throw missingTable();
        return 'swept';
      },
      { ...noSleep, onWaiting: () => (notices += 1) },
    );
    expect(result).toBe('swept');
    expect(calls).toBe(4);
    expect(notices).toBe(1);
  });

  it('does not hide any other error', async () => {
    let calls = 0;
    await expect(
      onceMigrated(async () => {
        calls += 1;
        throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      }, noSleep),
    ).rejects.toThrow('refused');
    expect(calls).toBe(1);
  });

  it('gives up when the tables never appear', async () => {
    let calls = 0;
    await expect(
      onceMigrated(
        async () => {
          calls += 1;
          throw missingTable();
        },
        { ...noSleep, intervalMs: 1000, timeoutMs: 3000 },
      ),
    ).rejects.toThrow('Failed query');
    expect(calls).toBe(4);
  });
});
