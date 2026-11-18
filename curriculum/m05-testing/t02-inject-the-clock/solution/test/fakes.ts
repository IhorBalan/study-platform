import type { Clock } from '../src/reset-tokens.ts';

/** A clock that only moves when the test says so. */
export class FakeClock implements Clock {
  #now: number;

  constructor(start = Date.UTC(2026, 0, 1, 9, 0, 0)) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}

/** Returns tok-1, tok-2, ... so tests can predict every token. */
export function sequentialIds(prefix = 'tok'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
