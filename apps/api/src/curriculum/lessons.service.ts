import { Injectable } from '@nestjs/common';
import { schema } from '@study/db';
import type { LessonDetail, LessonProgressResponse, ProgressStatus } from '@study/shared';
import { eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.module.js';
import { CurriculumService } from './curriculum.service.js';

@Injectable()
export class LessonsService {
  constructor(
    private readonly curriculum: CurriculumService,
    @InjectDb() private readonly db: Database,
  ) {}

  async get(lessonId: string): Promise<LessonDetail> {
    const lesson = this.curriculum.lesson(lessonId);
    const sequence = this.curriculum.lessonSequence();
    const index = sequence.findIndex((l) => l.id === lessonId);
    const previous = sequence[index - 1];
    const next = sequence[index + 1];

    const [progress] = await this.db
      .select({ status: schema.lessonProgress.status })
      .from(schema.lessonProgress)
      .where(eq(schema.lessonProgress.lessonId, lessonId));

    return {
      id: lesson.id,
      moduleId: lesson.moduleId,
      moduleTitle: this.curriculum.module(lesson.moduleId).title,
      title: lesson.title,
      markdown: lesson.markdown,
      status: progress?.status ?? 'not_started',
      cardCount: lesson.cards.length,
      previous: previous ? { id: previous.id, title: previous.title } : null,
      next: next ? { id: next.id, title: next.title } : null,
    };
  }

  /**
   * Records progress. Completing a lesson adds its curated deck to the review
   * queue. Decks are added on completion, not at start-up, so the queue only
   * ever holds cards for material the learner has actually read.
   */
  async setProgress(lessonId: string, status: ProgressStatus): Promise<LessonProgressResponse> {
    const lesson = this.curriculum.lesson(lessonId);
    const { lessonProgress, cards, cardSchedules, cardSkills } = schema;
    const now = new Date();

    return this.db.transaction(async (tx) => {
      await tx
        .insert(lessonProgress)
        .values({
          lessonId,
          status,
          startedAt: status === 'not_started' ? null : now,
          completedAt: status === 'done' ? now : null,
        })
        .onConflictDoUpdate({
          target: lessonProgress.lessonId,
          set: { status, completedAt: status === 'done' ? now : null },
        });

      if (status !== 'done' || lesson.cards.length === 0) return { status, cardsAdded: 0 };

      // sourceKey is unique, so completing a lesson twice never duplicates cards
      // and never resets the schedule of cards already under review.
      const inserted = await tx
        .insert(cards)
        .values(
          lesson.cards.map((c) => ({
            type: c.type,
            front: c.front,
            back: c.back,
            source: 'lesson' as const,
            status: 'active' as const,
            lessonId,
            sourceKey: c.key,
          })),
        )
        .onConflictDoNothing({ target: cards.sourceKey })
        .returning({ id: cards.id, sourceKey: cards.sourceKey });

      if (inserted.length > 0) {
        await tx.insert(cardSchedules).values(inserted.map((c) => ({ cardId: c.id, due: now })));
        const byKey = new Map(lesson.cards.map((c) => [c.key, c] as const));
        const links = inserted.flatMap((c) =>
          (byKey.get(c.sourceKey ?? '')?.skills ?? []).map((skillId) => ({ cardId: c.id, skillId })),
        );
        if (links.length > 0) await tx.insert(cardSkills).values(links);
      }
      return { status, cardsAdded: inserted.length };
    });
  }
}
