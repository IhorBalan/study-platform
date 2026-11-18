import { Injectable } from '@nestjs/common';
import { schema } from '@study/db';
import type { LessonDetail, LessonProgressResponse, ProgressStatus } from '@study/shared';
import { eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.module.js';
import { CurriculumService } from './curriculum.service.js';
import { DeckSyncService } from './deck-sync.service.js';

@Injectable()
export class LessonsService {
  constructor(
    private readonly curriculum: CurriculumService,
    private readonly decks: DeckSyncService,
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
    const { lessonProgress } = schema;
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

      // Completing a lesson twice never duplicates cards and never resets a schedule.
      return { status, cardsAdded: await this.decks.addDeck(tx, lesson, now) };
    });
  }
}
