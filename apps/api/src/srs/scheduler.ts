import type { CardState, Grade } from '@study/shared';
import { DefaultScheduler, Rating } from 'ts-fsrs';

/** FSRS model used for scheduling. Stored with each review so history stays interpretable. */
export const FSRS_VERSION = 'FSRS-7';

type Scheduler = Awaited<ReturnType<typeof DefaultScheduler>>;
/**
 * The fields this app reads from a ts-fsrs card. The library's own card type is a
 * union over model versions, which TypeScript cannot narrow from a `version`
 * string, so cards are passed back to it through `asLibraryCard`.
 */
export interface FsrsCard {
  cardId: string | number;
  state: number;
  dueAt: Date;
  lastReviewAt: Date | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  [field: string]: unknown;
}

const asLibraryCard = (card: FsrsCard) => card as never;

const GRADE_TO_RATING = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const satisfies Record<Grade, Rating>;

const RATING_TO_GRADE: Record<number, Grade> = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };
const STATES: CardState[] = ['new', 'learning', 'review', 'relearning'];

const schedulers = new Map<number, Promise<Scheduler>>();

/** One scheduler per desired-retention value; building one is async, so they are cached. */
function schedulerFor(desiredRetention: number): Promise<Scheduler> {
  let scheduler = schedulers.get(desiredRetention);
  if (!scheduler) {
    scheduler = DefaultScheduler({ version: FSRS_VERSION, desiredRetention });
    schedulers.set(desiredRetention, scheduler);
  }
  return scheduler;
}

/**
 * ts-fsrs cards hold Date objects. They are stored as JSON, where dates become
 * strings, so they are revived here before being handed back to the library.
 */
function revive(stored: Record<string, unknown>): FsrsCard {
  const card = { ...stored } as Record<string, unknown>;
  for (const key of ['dueAt', 'lastReviewAt']) {
    const value = card[key];
    if (typeof value === 'string') card[key] = new Date(value);
  }
  return card as unknown as FsrsCard;
}

export interface ScheduleSnapshot {
  state: CardState;
  due: Date;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReviewAt: Date | null;
  fsrs: FsrsCard;
}

function snapshot(card: FsrsCard): ScheduleSnapshot {
  return {
    state: STATES[card.state] ?? 'new',
    due: card.dueAt,
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewAt: card.lastReviewAt ?? null,
    fsrs: card,
  };
}

export async function loadCard(
  stored: unknown,
  cardId: string,
  desiredRetention: number,
  now: Date,
): Promise<FsrsCard> {
  const scheduler = await schedulerFor(desiredRetention);
  const hasState = typeof stored === 'object' && stored !== null && 'dueAt' in stored;
  if (!hasState) return { ...scheduler.newCard({ now }), cardId } as FsrsCard;
  return revive(stored as Record<string, unknown>);
}

/** Where the card would land for each grade, without changing anything. */
export async function previewCard(
  card: FsrsCard,
  desiredRetention: number,
  now: Date,
): Promise<Record<Grade, Date>> {
  const scheduler = await schedulerFor(desiredRetention);
  const result = {} as Record<Grade, Date>;
  for (const item of scheduler.preview({ card: asLibraryCard(card), now })) {
    const grade = RATING_TO_GRADE[item.grade];
    if (grade) result[grade] = (item.card as FsrsCard).dueAt;
  }
  return result;
}

export async function reviewCard(
  card: FsrsCard,
  grade: Grade,
  desiredRetention: number,
  now: Date,
): Promise<{ next: ScheduleSnapshot; stateBefore: CardState; log: unknown }> {
  const scheduler = await schedulerFor(desiredRetention);
  const result = scheduler.review({
    card: asLibraryCard(card),
    grade: GRADE_TO_RATING[grade],
    now,
  });
  return {
    next: snapshot(result.card as FsrsCard),
    stateBefore: STATES[card.state] ?? 'new',
    log: { ...result.revlog, model: FSRS_VERSION, desiredRetention },
  };
}
