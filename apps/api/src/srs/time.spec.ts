import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addLocalDays, localDayKeys, startOfLocalDay } from './time.js';

describe('local days across a daylight saving change', () => {
  const before = process.env.TZ;
  beforeAll(() => {
    // Clocks in Berlin go forward on 2027-03-28 and back on 2027-10-31.
    process.env.TZ = 'Europe/Berlin';
  });
  afterAll(() => {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  });

  it('lists every day once when a day has 23 hours', () => {
    const today = startOfLocalDay(new Date(2027, 3, 10, 15));
    const keys = localDayKeys(addLocalDays(today, -29), 30);
    expect(keys[0]).toBe('2027-03-12');
    expect(keys.at(-1)).toBe('2027-04-10');
    expect(new Set(keys).size).toBe(30);
    expect(keys).toContain('2027-03-28');
  });

  it('lists every day once when a day has 25 hours', () => {
    const start = startOfLocalDay(new Date(2027, 9, 25, 9));
    expect(localDayKeys(start, 14)).toEqual([
      '2027-10-25',
      '2027-10-26',
      '2027-10-27',
      '2027-10-28',
      '2027-10-29',
      '2027-10-30',
      '2027-10-31',
      '2027-11-01',
      '2027-11-02',
      '2027-11-03',
      '2027-11-04',
      '2027-11-05',
      '2027-11-06',
      '2027-11-07',
    ]);
  });

  it('keeps midnight at midnight', () => {
    const next = addLocalDays(startOfLocalDay(new Date(2027, 2, 27, 12)), 2);
    expect([next.getDate(), next.getHours()]).toEqual([29, 0]);
  });
});
