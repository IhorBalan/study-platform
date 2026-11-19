import { describe, expect, it } from 'vitest';
import { nothingToReview } from '../src/lib/nothingToReview';

const error = (message: string) => ({ status: 'error', error: message });

describe('nothingToReview', () => {
  it('is true when the code cannot be found', () => {
    const missing = [
      'Commit deadbeef was not found in the lab repository.',
      'The lab repository was not found at /home/me/lab.',
      'The folder m00-foundations/t01-raw-http-server does not exist in commit 6244346f5c. Run "pnpm lab start m00-foundations/t01-raw-http-server" and commit your work.',
      'The lab repository has no commits yet. Commit your work first.',
      'Set the path of your lab repository on the Settings page, then submit again.',
    ];
    expect(missing.filter((message) => !nothingToReview(error(message)))).toEqual([]);
  });

  it('is false when the code is there but the checks did not run', () => {
    const present = [
      'The checker restarted while this run was in progress. Submit again.',
      'The checks could not be queued. Submit again.',
      'Docker is not running.',
    ];
    expect(present.filter((message) => nothingToReview(error(message)))).toEqual([]);
    expect(nothingToReview({ status: 'not_run', error: 'The host bridge is not running.' })).toBe(
      false,
    );
  });

  it('is false for a run that ran, and for a written answer', () => {
    expect(nothingToReview({ status: 'failed', error: null })).toBe(false);
    expect(nothingToReview({ status: 'passed', error: null })).toBe(false);
    expect(nothingToReview(undefined)).toBe(false);
  });
});
