import { Injectable } from '@nestjs/common';
import { schema } from '@study/db';
import type { ModuleSummary, NextUp, PlanResponse, ProgressStatus } from '@study/shared';
import { asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { CurriculumService } from '../curriculum/curriculum.service.js';
import { InjectDb, type Database } from '../database/database.module.js';
import { ReviewService } from '../srs/review.service.js';

@Injectable()
export class PlanService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly curriculum: CurriculumService,
    private readonly review: ReviewService,
  ) {}

  /** Modules in recommended order with progress, plus what to do next. */
  async getPlan(now = new Date()): Promise<PlanResponse> {
    const { modules, lessons, tasks, lessonProgress, reviewTasks, skills, studySessions } = schema;

    const [moduleRows, lessonRows, taskRows, taskProgress, openReviewTasks, queue, lastOpened] =
      await Promise.all([
        this.db
          .select()
          .from(modules)
          .where(eq(modules.present, true))
          .orderBy(asc(modules.position)),
        this.db
          .select({
            id: lessons.id,
            moduleId: lessons.moduleId,
            title: lessons.title,
            position: lessons.position,
            status: lessonProgress.status,
          })
          .from(lessons)
          .leftJoin(lessonProgress, eq(lessonProgress.lessonId, lessons.id))
          .where(eq(lessons.present, true))
          .orderBy(asc(lessons.position)),
        this.db.select().from(tasks).where(eq(tasks.present, true)).orderBy(asc(tasks.position)),
        this.db.execute<{
          task_id: string;
          submissions: number;
          passed: number;
          checked: number;
          reviewed: number;
        }>(sql`
          select s.task_id,
                 count(distinct s.id)::int as submissions,
                 count(*) filter (where r.stage = 'checks' and r.status = 'passed')::int as passed,
                 count(*) filter (where r.stage = 'checks')::int as checked,
                 count(*) filter (where r.stage = 'review' and r.status = 'passed')::int as reviewed
          from submissions s left join verification_runs r on r.submission_id = s.id
          group by s.task_id
        `),
        this.db
          .select({
            id: reviewTasks.id,
            skillId: reviewTasks.skillId,
            skillTitle: skills.title,
            reason: reviewTasks.reason,
          })
          .from(reviewTasks)
          .innerJoin(skills, eq(skills.id, reviewTasks.skillId))
          .where(eq(reviewTasks.status, 'open'))
          .orderBy(asc(reviewTasks.createdAt)),
        this.review.summary(now),
        // The page opened last. Review sessions have no item and are skipped.
        this.db
          .select({ activity: studySessions.activity, itemId: studySessions.itemId })
          .from(studySessions)
          .where(isNotNull(studySessions.itemId))
          .orderBy(desc(studySessions.startedAt))
          .limit(1),
      ]);

    const progress = new Map(taskProgress.rows.map((r) => [r.task_id, r]));
    const taskStatus = (id: string): ProgressStatus => {
      const row = progress.get(id);
      if (!row) return 'not_started';
      if (row.passed > 0) return 'done';
      // Without automated checks, a stored review is what finishes a task. A saved
      // answer alone is work in progress.
      if (row.checked === 0 && row.reviewed > 0) return 'done';
      return 'in_progress';
    };

    const result: ModuleSummary[] = moduleRows.map((m) => ({
      id: m.id,
      title: m.title,
      summary: m.summary,
      position: m.position,
      kind: m.kind,
      effort: m.effort,
      services: m.services,
      lessons: lessonRows
        .filter((l) => l.moduleId === m.id)
        .map((l) => ({
          id: l.id,
          title: l.title,
          position: l.position,
          status: l.status ?? 'not_started',
        })),
      tasks: taskRows
        .filter((t) => t.moduleId === m.id)
        .map((t) => ({
          id: t.id,
          title: t.title,
          position: t.position,
          type: t.submissionType,
          status: taskStatus(t.id),
        })),
    }));

    // The next lesson comes from the core path first; optional modules never block it.
    const ordered = [
      ...result.filter((m) => m.kind === 'core'),
      ...result.filter((m) => m.kind !== 'core'),
    ];
    let lesson: NextUp['lesson'] = null;
    for (const m of ordered) {
      const next = m.lessons.find((l) => l.status !== 'done');
      if (next) {
        lesson = { id: next.id, title: next.title, moduleTitle: m.title };
        break;
      }
    }
    const started = result.filter(
      (m) =>
        m.lessons.some((l) => l.status !== 'not_started') ||
        m.tasks.some((t) => t.status !== 'not_started'),
    );
    const openTasks = started
      .flatMap((m) =>
        m.tasks
          .filter((t) => t.status !== 'done')
          .map((t) => ({ id: t.id, title: t.title, moduleTitle: m.title, type: t.type })),
      )
      .slice(0, 6);

    let continueWith: NextUp['continueWith'] = null;
    const last = lastOpened[0];
    if (last?.itemId && last.itemId !== lesson?.id) {
      for (const m of result) {
        const item =
          last.activity === 'lesson'
            ? m.lessons.find((l) => l.id === last.itemId)
            : m.tasks.find((t) => t.id === last.itemId);
        if (item && item.status !== 'done') {
          continueWith = {
            kind: last.activity === 'lesson' ? 'lesson' : 'task',
            id: item.id,
            title: item.title,
            moduleTitle: m.title,
          };
        }
      }
    }

    const lessonForSkill = (skillId: string): string | null =>
      this.curriculum
        .allModules()
        .flatMap((m) => m.lessons)
        .find((l) => l.skills.includes(skillId))?.id ?? null;

    return {
      modules: result,
      nextUp: {
        continueWith,
        lesson,
        tasks: openTasks,
        dueCards: queue.counts.due,
        newCards: queue.counts.newAvailable,
        secondsPerCard: queue.secondsPerCard,
        pendingCards: queue.counts.pendingApproval,
        reviewTasks: openReviewTasks.map((t) => ({ ...t, lessonId: lessonForSkill(t.skillId) })),
      },
    };
  }
}
