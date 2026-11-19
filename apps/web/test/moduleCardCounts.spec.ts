import { describe, expect, it } from 'vitest';
import { moduleCardCounts } from '../src/lib/moduleCardCounts';

describe('moduleCardCounts', () => {
  it('counts cards by the module of their lesson', () => {
    const counts = moduleCardCounts([
      { lessonId: 'm00-foundations/l01-http' },
      { lessonId: 'm00-foundations/l02-node' },
      { lessonId: 'm07-caching/l01-cache-aside' },
    ]);
    expect([...counts]).toEqual([
      ['m00-foundations', 2],
      ['m07-caching', 1],
    ]);
  });

  it('leaves out cards that belong to no lesson', () => {
    expect(moduleCardCounts([{ lessonId: null }]).size).toBe(0);
  });
});
