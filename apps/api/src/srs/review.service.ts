import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@study/db';
import type {
  Grade,
  QueueCard,
  ReviewQueueResponse,
  SubmitReview,
  SubmitReviewResponse,
  UndoReviewResponse,
} from '@study/shared';
import { CardState } from '@study/shared';
import { and, asc, count, desc, eq, gt, gte, like, lte, min, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { InjectDb, type Database } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { CardsService } from './cards.service.js';
import { loadCard, previewCard, reviewCard } from './scheduler.js';
import { startOfLocalDay } from './time.js';

const { cards, cardSchedules, reviews } = schema;

/** A grade can be taken back for this long. After that it is history. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/** What a review row keeps of the schedule it replaced. */
const ScheduleSnapshot = z.object({
  state: CardState,
  due: z.string(),
  stability: z.number(),
  difficulty: z.number(),
  reps: z.number().int(),
  lapses: z.number().int(),
  lastReviewAt: z.string().nullable(),
  fsrs: z.unknown(),
});
type ScheduleSnapshot = z.infer<typeof ScheduleSnapshot>;

/** The pace estimate: defaults and what counts as a real answer time. */
const DEFAULT_SECONDS_PER_CARD = 8;
const PACE_WINDOW_DAYS = 14;
const MIN_TIMED_REVIEWS = 10;
/** Under half a second is a mis-key; over two minutes the learner walked away. */
const MIN_ANSWER_MS = 500;
const MAX_ANSWER_MS = 120_000;

/** How many cards one queue request returns. The client asks again when it runs out. */
const BATCH = 20;

/** The queue's numbers, without the cards. */
export type ReviewSummary = Omit<ReviewQueueResponse, 'cards'>;

@Injectable()
export class ReviewService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly cardsService: CardsService,
  ) {}

  /** What is left of today's limits. Both count from local midnight. */
  private async allowances(now: Date) {
    const settings = await this.settings.get();
    const dayStart = startOfLocalDay(now);
    const [todayNew, todaySeen] = await Promise.all([
      this.countReviews(dayStart, true),
      this.countReviews(dayStart, false),
    ]);
    return {
      settings,
      reviewedToday: todayNew + todaySeen,
      newAllowance: Math.max(0, settings.newCardsPerDay - todayNew),
      reviewAllowance: Math.max(0, settings.reviewsPerDay - todaySeen),
    };
  }

  /** Active cards, of one module's lessons when a module is given. */
  private activeCards(moduleId?: string) {
    // Lesson ids are "<module>/<slug>". Module ids have no LIKE wildcards in them.
    return moduleId
      ? and(eq(cards.status, 'active'), like(cards.lessonId, `${moduleId}/%`))
      : eq(cards.status, 'active');
  }

  private async summaryWith(
    now: Date,
    moduleId: string | undefined,
    limits: Awaited<ReturnType<ReviewService['allowances']>>,
  ): Promise<ReviewSummary> {
    const active = this.activeCards(moduleId);
    const [dueCount, newCount, upcoming, pending, secondsPerCard] = await Promise.all([
      this.db
        .select({ n: count() })
        .from(cards)
        .innerJoin(cardSchedules, eq(cardSchedules.cardId, cards.id))
        .where(and(active, ne(cardSchedules.state, 'new'), lte(cardSchedules.due, now))),
      this.db
        .select({ n: count() })
        .from(cards)
        .innerJoin(cardSchedules, eq(cardSchedules.cardId, cards.id))
        .where(and(active, eq(cardSchedules.state, 'new'))),
      this.db
        .select({ due: min(cardSchedules.due) })
        .from(cards)
        .innerJoin(cardSchedules, eq(cardSchedules.cardId, cards.id))
        .where(and(active, ne(cardSchedules.state, 'new'), gt(cardSchedules.due, now))),
      this.db.select({ n: count() }).from(cards).where(eq(cards.status, 'pending')),
      this.secondsPerCard(now),
    ]);
    return {
      counts: {
        due: Math.min(dueCount[0]?.n ?? 0, limits.reviewAllowance),
        newAvailable: Math.min(newCount[0]?.n ?? 0, limits.newAllowance),
        reviewedToday: limits.reviewedToday,
        pendingApproval: pending[0]?.n ?? 0,
      },
      nextDue: upcoming[0]?.due?.toISOString() ?? null,
      reviewLimitReached: limits.reviewAllowance === 0,
      secondsPerCard,
    };
  }

  /**
   * The numbers of the queue without its cards. The Plan and Stats pages show
   * only these, so they do not pay for loading cards and previewing every grade.
   */
  async summary(now = new Date(), moduleId?: string): Promise<ReviewSummary> {
    return this.summaryWith(now, moduleId, await this.allowances(now));
  }

  /**
   * Due cards first (oldest due date first), then new cards up to the daily
   * limit.
   *
   * With a module id the queue holds only cards from that module's lessons.
   * The daily limits still apply, and they count every review of the day.
   */
  async queue(now = new Date(), moduleId?: string): Promise<ReviewQueueResponse> {
    const limits = await this.allowances(now);
    const { settings } = limits;
    const active = this.activeCards(moduleId);
    const base = () =>
      this.db.select().from(cards).innerJoin(cardSchedules, eq(cardSchedules.cardId, cards.id));

    const [dueRows, newRows, summary] = await Promise.all([
      base()
        .where(and(active, ne(cardSchedules.state, 'new'), lte(cardSchedules.due, now)))
        .orderBy(asc(cardSchedules.due))
        .limit(Math.min(BATCH, limits.reviewAllowance)),
      base()
        .where(and(active, eq(cardSchedules.state, 'new')))
        .orderBy(asc(cards.createdAt), asc(cards.sourceKey))
        .limit(Math.min(BATCH, limits.newAllowance)),
      this.summaryWith(now, moduleId, limits),
    ]);

    const rows = [...dueRows, ...newRows].slice(0, BATCH);
    const dtos = await this.cardsService.toDtos(rows);
    const queueCards: QueueCard[] = await Promise.all(
      rows.map(async (row, i) => {
        const fsrsCard = await loadCard(
          row.card_schedules.fsrs,
          row.cards.id,
          settings.desiredRetention,
          now,
        );
        const preview = await previewCard(fsrsCard, settings.desiredRetention, now);
        const dto = dtos[i];
        if (!dto) throw new Error('card dto missing');
        return {
          ...dto,
          preview: Object.fromEntries(
            Object.entries(preview).map(([grade, due]) => [grade, due.toISOString()]),
          ) as Record<Grade, string>,
        };
      }),
    );

    return { cards: queueCards, ...summary };
  }

  /** Applies a grade: appends a review row and replaces the card's schedule, atomically. */
  async submit(
    cardId: string,
    input: SubmitReview,
    now = new Date(),
  ): Promise<SubmitReviewResponse> {
    const settings = await this.settings.get();

    return this.db.transaction(async (tx) => {
      // Lock the schedule row so concurrent grades for one card run one after the other.
      const [row] = await tx
        .select()
        .from(cards)
        .innerJoin(cardSchedules, eq(cardSchedules.cardId, cards.id))
        .where(eq(cards.id, cardId))
        .for('update', { of: cardSchedules });
      if (!row) throw new NotFoundException(`Card "${cardId}" does not exist`);
      if (row.cards.status !== 'active') {
        throw new ConflictException(`Card is ${row.cards.status} and cannot be reviewed`);
      }
      // A second request for the same card (another tab, a retry) arrives here
      // after the first one moved the due date forward, and is refused.
      if (row.card_schedules.state !== 'new' && row.card_schedules.due > now) {
        throw new ConflictException('Card is not due yet. It may have been graded already.');
      }

      const fsrsCard = await loadCard(
        row.card_schedules.fsrs,
        cardId,
        settings.desiredRetention,
        now,
      );
      const { next, stateBefore, log } = await reviewCard(
        fsrsCard,
        input.grade,
        settings.desiredRetention,
        now,
      );

      const before = row.card_schedules;
      const scheduleBefore: ScheduleSnapshot = {
        state: before.state,
        due: before.due.toISOString(),
        stability: before.stability,
        difficulty: before.difficulty,
        reps: before.reps,
        lapses: before.lapses,
        lastReviewAt: before.lastReviewAt?.toISOString() ?? null,
        fsrs: before.fsrs,
      };
      const [review] = await tx
        .insert(reviews)
        .values({
          cardId,
          grade: input.grade,
          stateBefore,
          reviewedAt: now,
          answerMs: input.answerMs ?? null,
          mode: 'self',
          fsrsLog: log,
          scheduleBefore,
        })
        .returning({ id: reviews.id });
      if (!review) throw new Error('review was not saved');
      await tx
        .update(cardSchedules)
        .set({
          state: next.state,
          due: next.due,
          stability: next.stability,
          difficulty: next.difficulty,
          reps: next.reps,
          lapses: next.lapses,
          lastReviewAt: next.lastReviewAt,
          fsrs: next.fsrs,
        })
        .where(eq(cardSchedules.cardId, cardId));

      return { state: next.state, due: next.due.toISOString(), reviewId: review.id };
    });
  }

  /**
   * Takes back the card's latest grade: removes that review and puts the schedule
   * back exactly as it was. Only a grade from the last few minutes can be undone.
   * With `reviewId`, only that grade: a second request for it finds it gone.
   */
  async undo(cardId: string, reviewId?: string, now = new Date()): Promise<UndoReviewResponse> {
    return this.db.transaction(async (tx) => {
      // Same lock as a grade, so an undo and a grade of one card cannot interleave.
      const [schedule] = await tx
        .select()
        .from(cardSchedules)
        .where(eq(cardSchedules.cardId, cardId))
        .for('update');
      if (!schedule) throw new NotFoundException(`Card "${cardId}" does not exist`);
      const [last] = await tx
        .select()
        .from(reviews)
        .where(eq(reviews.cardId, cardId))
        .orderBy(desc(reviews.reviewedAt))
        .limit(1);
      if (!last) throw new ConflictException('This card has no grade to undo.');
      if (reviewId && last.id !== reviewId) {
        throw new ConflictException('This grade was already undone, or the card was graded again.');
      }
      if (now.getTime() - last.reviewedAt.getTime() > UNDO_WINDOW_MS) {
        throw new ConflictException(
          'This grade is more than 10 minutes old and can no longer be undone.',
        );
      }
      const snapshot = ScheduleSnapshot.safeParse(last.scheduleBefore);
      if (!snapshot.success) {
        throw new ConflictException('This grade was saved without what is needed to undo it.');
      }
      const before = snapshot.data;
      await tx.delete(reviews).where(eq(reviews.id, last.id));
      await tx
        .update(cardSchedules)
        .set({
          state: before.state,
          due: new Date(before.due),
          stability: before.stability,
          difficulty: before.difficulty,
          reps: before.reps,
          lapses: before.lapses,
          lastReviewAt: before.lastReviewAt ? new Date(before.lastReviewAt) : null,
          fsrs: before.fsrs,
        })
        .where(eq(cardSchedules.cardId, cardId));
      return { state: before.state, due: before.due };
    });
  }

  /**
   * The median answer time over the last 14 days. With fewer than ten timed
   * reviews there is nothing to go on, so a default is used.
   */
  private async secondsPerCard(now: Date): Promise<number> {
    const since = new Date(now.getTime() - PACE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.db.execute<{ n: number; median_ms: number | null }>(sql`
      select count(*)::int as n,
             percentile_cont(0.5) within group (order by answer_ms)::float8 as median_ms
      from reviews
      where reviewed_at >= ${since} and answer_ms is not null
            and answer_ms between ${MIN_ANSWER_MS} and ${MAX_ANSWER_MS}
    `);
    const row = result.rows[0];
    if (!row || row.n < MIN_TIMED_REVIEWS || row.median_ms === null)
      return DEFAULT_SECONDS_PER_CARD;
    return Math.round(row.median_ms / 100) / 10;
  }

  private async countReviews(since: Date, firstSight: boolean): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(reviews)
      .where(
        and(
          gte(reviews.reviewedAt, since),
          firstSight ? eq(reviews.stateBefore, 'new') : ne(reviews.stateBefore, 'new'),
        ),
      );
    return row?.n ?? 0;
  }
}
