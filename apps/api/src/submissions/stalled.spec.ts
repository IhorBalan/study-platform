import { describe, expect, it } from 'vitest';
import { isStalled } from './stalled.js';

const now = new Date('2027-01-10T12:00:00Z');
const waiting = (seconds: number) => ({
  status: 'queued',
  createdAt: new Date(now.getTime() - seconds * 1000),
});

describe('isStalled', () => {
  it('is false for a run that has only just been queued', () => {
    expect(isStalled(waiting(5), false, now)).toBe(false);
  });

  it('is true for a run that keeps waiting while nothing else runs', () => {
    expect(isStalled(waiting(21), false, now)).toBe(true);
  });

  it('is false for a run that waits behind another one', () => {
    expect(isStalled(waiting(300), true, now)).toBe(false);
  });

  it('is false once the run has started or ended', () => {
    const old = new Date(now.getTime() - 300_000);
    expect(isStalled({ status: 'running', createdAt: old }, false, now)).toBe(false);
    expect(isStalled({ status: 'passed', createdAt: old }, false, now)).toBe(false);
  });
});
