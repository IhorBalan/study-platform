import { describe, expect, it } from 'vitest';
import { waitForNextDue } from '../src/lib/reviewWait';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString();

describe('waitForNextDue', () => {
  it('does not wait while there are cards, or when nothing is scheduled', () => {
    expect(waitForNextDue(undefined, NOW)).toBe(false);
    expect(waitForNextDue({ cards: [{}], nextDue: inSeconds(30) }, NOW)).toBe(false);
    expect(waitForNextDue({ cards: [], nextDue: null }, NOW)).toBe(false);
  });

  it('asks again just after a card that is due within seconds', () => {
    expect(waitForNextDue({ cards: [], nextDue: inSeconds(5) }, NOW)).toBe(5_500);
  });

  it('checks every 15 seconds while the card is minutes away', () => {
    expect(waitForNextDue({ cards: [], nextDue: inSeconds(600) }, NOW)).toBe(15_000);
  });

  it('retries soon when the card is already due', () => {
    expect(waitForNextDue({ cards: [], nextDue: inSeconds(-30) }, NOW)).toBe(1_000);
  });

  it('does not poll for a card that is hours away', () => {
    expect(waitForNextDue({ cards: [], nextDue: inSeconds(3 * 3600) }, NOW)).toBe(false);
  });
});
