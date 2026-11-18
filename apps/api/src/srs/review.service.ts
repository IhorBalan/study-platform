import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@study/db';
import type {
  Grade,
  QueueCard,
  ReviewQueueResponse,
  SubmitReview,
  SubmitReviewResponse,
} from '@study/shared';
import { and, asc, count, eq, gt, gte, lte, min, ne } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { CardsService } from './cards.service.js';
import { loadCard, previewCard, reviewCard } from './scheduler.js';
import { startOfLocalDay } from './time.js';

const { cards, cardSchedules, reviews } = schema;

/** How many cards one queue request returns. The client asks again when it runs out. */
const BATCH = 20;

@Injectable()
export class ReviewService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly cardsService: CardsService,
  ) {}

  /**
   * Due cards first (oldest due date first), then new cards up to the daily
   * limit. Both limits count from local midnight.
   */
  async queue(now = new Date()): Promise<ReviewQueueResponse> {
    const settings = await this.settings.get();
    const dayStart = startOfLocalDay(now);

    const [todayNew, todaySeen, pending] = await Promise.all([
      this.countReviews(dayStart, true),
      this.countReviews(dayStart, false),
      this.db.select({ n: count() }).from(cards).where(eq(cards.status, 'pending')),
    ]);
    const newAllowance = Math.max(0, settings.newCardsPerDay - todayNew);
    const reviewAllowance = Math.max(0, settings.reviewsPerDay - todaySeen);

    const active = eq(cards.status, 'active');
    const base = () =>
      this.db.select().from(cards).innerJoin(cardSchedules, eq(cardSchedules.cardId, cards.id));

    const [dueRows, dueCount, newRows, newCount, upcoming] = await Promise.all([
      base()
        .where(and(active, ne(cardSchedules.state, 'new'), lte(cardSchedules.due, now)))
        .orderBy(asc(cardSchedules.due))
        .limit(Math.min(BATCH, reviewAllowance)),
      this.db
        .select({ n: count() })
        .from(cards)
        .innerJoin(cardSchedules, eq(cardSchedules.cardId, cards.id))
        .where(and(active, ne(cardSchedules.state, 'new'), lte(cardSchedules.due, now))),
      base()
        .where(and(active, eq(cardSchedules.state, 'new')))
        .orderBy(asc(cards.createdAt), asc(cards.sourceKey))
        .limit(Math.min(BATCH, newAllowance)),
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

    return {
      cards: queueCards,
      counts: {
        due: Math.min(dueCount[0]?.n ?? 0, reviewAllowance),
        newAvailable: Math.min(newCount[0]?.n ?? 0, newAllowance),
        reviewedToday: todayNew + todaySeen,
        pendingApproval: pending[0]?.n ?? 0,
      },
      nextDue: upcoming[0]?.due?.toISOString() ?? null,
    };
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

      await tx.insert(reviews).values({
        cardId,
        grade: input.grade,
        stateBefore,
        reviewedAt: now,
        answerMs: input.answerMs ?? null,
        mode: 'self',
        fsrsLog: log,
      });
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

      return { state: next.state, due: next.due.toISOString() };
    });
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
