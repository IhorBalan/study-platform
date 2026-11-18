import { describe, expect, it } from 'vitest';
import { agoLabel, reviewEstimate } from '../src/lib/format';

describe('reviewEstimate', () => {
  it('rounds to whole minutes', () => {
    expect(reviewEstimate(32, 17)).toBe('about 9 min');
  });

  it('never promises less than a minute', () => {
    expect(reviewEstimate(1, 8)).toBe('about 1 min');
  });

  it('says nothing when there are no cards', () => {
    expect(reviewEstimate(0, 8)).toBe('');
  });
});

describe('agoLabel', () => {
  const now = new Date('2026-11-18T12:00:00Z').getTime();

  it('picks a unit that fits the distance', () => {
    expect(agoLabel('2026-11-18T11:59:30Z', now)).toBe('just now');
    expect(agoLabel('2026-11-18T11:40:00Z', now)).toBe('20 minutes ago');
    expect(agoLabel('2026-11-18T11:00:00Z', now)).toBe('1 hour ago');
    expect(agoLabel('2026-11-13T12:00:00Z', now)).toBe('5 days ago');
  });
});
