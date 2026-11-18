import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { LoadedLesson } from '@study/curriculum';
import { schema } from '@study/db';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.module.js';
import { CurriculumService } from './curriculum.service.js';

const { cards, cardSchedules, cardSkills, lessonProgress, removedLessonCards } = schema;

/** A transaction, or the database itself: both can run the same queries. */
type Executor = Pick<Database, 'select' | 'insert' | 'update'>;

/**
 * Keeps the learner's copies of lesson cards in step with the curriculum files.
 *
 * A lesson's deck is copied into the database when the lesson is completed.
 * Without this, a card that is corrected later, or added to a lesson already
 * finished, would never reach the learner.
 */
@Injectable()
export class DeckSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeckSyncService.name);

  constructor(
    private readonly curriculum: CurriculumService,
    @InjectDb() private readonly db: Database,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { updated, added } = await this.sync();
    if (updated > 0 || added > 0) {
      this.logger.log(`Lesson cards brought up to date: ${updated} corrected, ${added} added`);
    }
  }

  /**
   * Adds the cards of one lesson that the learner does not have yet, as new cards.
   * Cards they deleted stay deleted, and cards they have keep their schedule.
   */
  async addDeck(tx: Executor, lesson: LoadedLesson, now: Date): Promise<number> {
    if (lesson.cards.length === 0) return 0;
    const removed = await tx
      .select({ key: removedLessonCards.sourceKey })
      .from(removedLessonCards)
      .where(
        inArray(
          removedLessonCards.sourceKey,
          lesson.cards.map((c) => c.key),
        ),
      );
    const gone = new Set(removed.map((r) => r.key));
    const wanted = lesson.cards.filter((c) => !gone.has(c.key));
    if (wanted.length === 0) return 0;

    // sourceKey is unique, so a card that is already there is left as it is.
    const inserted = await tx
      .insert(cards)
      .values(
        wanted.map((c) => ({
          type: c.type,
          front: c.front,
          back: c.back,
          source: 'lesson' as const,
          status: 'active' as const,
          lessonId: lesson.id,
          sourceKey: c.key,
        })),
      )
      .onConflictDoNothing({ target: cards.sourceKey })
      .returning({ id: cards.id, sourceKey: cards.sourceKey });
    if (inserted.length === 0) return 0;

    await tx.insert(cardSchedules).values(inserted.map((c) => ({ cardId: c.id, due: now })));
    const byKey = new Map(lesson.cards.map((c) => [c.key, c] as const));
    const links = inserted.flatMap((c) =>
      (byKey.get(c.sourceKey ?? '')?.skills ?? []).map((skillId) => ({ cardId: c.id, skillId })),
    );
    if (links.length > 0) await tx.insert(cardSkills).values(links);
    return inserted.length;
  }

  /**
   * Corrects the text of lesson cards that changed in the files, and adds cards
   * that were written for a lesson after the learner finished it.
   * A card the learner edited is theirs and is not touched.
   */
  async sync(now = new Date()): Promise<{ updated: number; added: number }> {
    return this.db.transaction(async (tx) => {
      const current = new Map(
        this.curriculum
          .allModules()
          .flatMap((m) => m.lessons)
          .flatMap((l) => l.cards.map((c) => [c.key, c] as const)),
      );

      const rows = await tx
        .select({
          id: cards.id,
          key: cards.sourceKey,
          type: cards.type,
          front: cards.front,
          back: cards.back,
        })
        .from(cards)
        .where(and(eq(cards.source, 'lesson'), isNotNull(cards.sourceKey), isNull(cards.editedAt)));
      let updated = 0;
      for (const row of rows) {
        const card = current.get(row.key ?? '');
        // A card that left the curriculum stays: the learner may be half-way through learning it.
        if (!card) continue;
        if (card.type === row.type && card.front === row.front && card.back === row.back) continue;
        await tx
          .update(cards)
          .set({ type: card.type, front: card.front, back: card.back })
          .where(eq(cards.id, row.id));
        updated++;
      }

      const done = await tx
        .select({ lessonId: lessonProgress.lessonId })
        .from(lessonProgress)
        .where(eq(lessonProgress.status, 'done'));
      const lessons = new Map(
        this.curriculum
          .allModules()
          .flatMap((m) => m.lessons)
          .map((l) => [l.id, l] as const),
      );
      let added = 0;
      for (const { lessonId } of done) {
        const lesson = lessons.get(lessonId);
        if (lesson) added += await this.addDeck(tx, lesson, now);
      }
      return { updated, added };
    });
  }
}
