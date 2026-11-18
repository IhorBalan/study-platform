import { Injectable } from '@nestjs/common';
import { schema } from '@study/db';
import type { ModuleSummary, PlanResponse } from '@study/shared';
import { asc, eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.module.js';

@Injectable()
export class PlanService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Modules in recommended order with their lessons, tasks and lesson progress. */
  async getPlan(): Promise<PlanResponse> {
    const { modules, lessons, tasks, lessonProgress } = schema;

    const [moduleRows, lessonRows, taskRows] = await Promise.all([
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
    ]);

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
        .map((t) => ({ id: t.id, title: t.title, position: t.position })),
    }));

    return { modules: result };
  }
}
