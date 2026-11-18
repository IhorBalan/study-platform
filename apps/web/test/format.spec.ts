import { describe, expect, it } from 'vitest';
import { reviewEstimate } from '../src/lib/format';

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
