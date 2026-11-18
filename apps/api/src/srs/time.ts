/** Start of the current local day. "Today" follows the learner's clock, not UTC. */
export function startOfLocalDay(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * The same local time a number of calendar days away. Adding 24 hours instead
 * is an hour off across a daylight saving change, which moves "midnight" into
 * the neighbouring day.
 */
export function addLocalDays(date: Date, days: number): Date {
  const moved = new Date(date);
  moved.setDate(moved.getDate() + days);
  return moved;
}

/** "2027-03-28" in the learner's time zone. */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The keys of `count` consecutive local days, starting with the day of `start`. */
export function localDayKeys(start: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => localDayKey(addLocalDays(start, i)));
}
