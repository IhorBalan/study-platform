const SOON_MS = 20 * 60_000;

/**
 * How long the Review page waits before asking for the queue again, or false
 * when there is nothing to wait for. A card graded Again is due again within
 * minutes, so an empty queue with a card that close refreshes by itself.
 */
export function waitForNextDue(
  data: { cards: unknown[]; nextDue: string | null; reviewLimitReached?: boolean } | undefined,
  now = Date.now(),
): number | false {
  if (!data || data.cards.length > 0 || !data.nextDue) return false;
  // At the daily limit the card would not be shown when it is due, so there is nothing to wait for.
  if (data.reviewLimitReached) return false;
  const untilDue = Date.parse(data.nextDue) - now;
  if (!(untilDue < SOON_MS)) return false;
  // Shortly after it is due, and at least every 15 seconds so the "due in" text keeps up.
  return Math.max(1_000, Math.min(untilDue + 500, 15_000));
}
