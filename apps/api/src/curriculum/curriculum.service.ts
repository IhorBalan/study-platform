import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  loadCurriculum,
  type LoadedLesson,
  type LoadedModule,
  type LoadedTask,
} from '@study/curriculum';
import { schema } from '@study/db';
import { notInArray, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env.js';
import { InjectDb, type Database } from '../database/database.module.js';

/**
 * Holds the curriculum in memory and keeps an index of it in the database.
 * Content stays in files; the database only needs ids to hang progress on.
 */
@Injectable()
export class CurriculumService implements OnModuleInit {
  private readonly logger = new Logger(CurriculumService.name);
  private modules: LoadedModule[] = [];
  private lessons = new Map<string, LoadedLesson>();
  private tasks = new Map<string, LoadedTask>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectDb() private readonly db: Database,
  ) {}

  async onModuleInit(): Promise<void> {
    const { modules, issues } = await loadCurriculum(this.env.CURRICULUM_DIR);
    if (issues.length > 0) {
      const lines = issues.map((i) => `  ${i.file}: ${i.message}`).join('\n');
      // Fail loudly: a half-loaded curriculum would silently hide lessons.
      throw new Error(`Curriculum has ${issues.length} problem(s):\n${lines}`);
    }
    this.modules = modules;
    this.lessons = new Map(modules.flatMap((m) => m.lessons.map((l) => [l.id, l] as const)));
    this.tasks = new Map(modules.flatMap((m) => m.tasks.map((t) => [t.id, t] as const)));
    await this.syncIndex();
    this.logger.log(
      `Loaded ${modules.length} modules, ${this.lessons.size} lessons, ${this.tasks.size} tasks`,
    );
  }

  /** Every skill id declared by any module. */
  skillIds(): string[] {
    return this.modules.flatMap((m) => m.skills.map((s) => s.id));
  }

  allModules(): readonly LoadedModule[] {
    return this.modules;
  }

  module(id: string): LoadedModule {
    const found = this.modules.find((m) => m.id === id);
    if (!found) throw new NotFoundException(`Module "${id}" does not exist`);
    return found;
  }

  lesson(id: string): LoadedLesson {
    const found = this.lessons.get(id);
    if (!found) throw new NotFoundException(`Lesson "${id}" does not exist`);
    return found;
  }

  task(id: string): LoadedTask {
    const found = this.tasks.get(id);
    if (!found) throw new NotFoundException(`Task "${id}" does not exist`);
    return found;
  }

  /** Lessons in reading order across all modules, for previous/next links. */
  lessonSequence(): LoadedLesson[] {
    return this.modules.flatMap((m) => m.lessons);
  }

  /** Upserts modules, lessons, tasks and skills, and flags rows whose files are gone. */
  private async syncIndex(): Promise<void> {
    const { modules, lessons, tasks, skills, taskSkills } = schema;
    const excluded = (column: string) => sql.raw(`excluded.${column}`);

    await this.db.transaction(async (tx) => {
      const skillRows = this.modules.flatMap((m) => m.skills);
      if (skillRows.length > 0) {
        await tx
          .insert(skills)
          .values(skillRows)
          .onConflictDoUpdate({ target: skills.id, set: { title: excluded('title') } });
      }

      const moduleRows = this.modules.map((m) => ({
        id: m.id,
        title: m.title,
        summary: m.summary,
        position: m.position,
        kind: m.kind,
        effort: m.effort,
        services: m.services,
        present: true,
      }));
      if (moduleRows.length > 0) {
        await tx
          .insert(modules)
          .values(moduleRows)
          .onConflictDoUpdate({
            target: modules.id,
            set: {
              title: excluded('title'),
              summary: excluded('summary'),
              position: excluded('position'),
              kind: excluded('kind'),
              effort: excluded('effort'),
              services: excluded('services'),
              present: true,
            },
          });
      }

      const lessonRows = [...this.lessons.values()].map((l) => ({
        id: l.id,
        moduleId: l.moduleId,
        title: l.title,
        position: l.position,
        present: true,
      }));
      if (lessonRows.length > 0) {
        await tx
          .insert(lessons)
          .values(lessonRows)
          .onConflictDoUpdate({
            target: lessons.id,
            set: { title: excluded('title'), position: excluded('position'), present: true },
          });
      }

      const taskRows = [...this.tasks.values()].map((t) => ({
        id: t.id,
        moduleId: t.moduleId,
        title: t.title,
        position: t.position,
        submissionType: t.type,
        present: true,
      }));
      if (taskRows.length > 0) {
        await tx
          .insert(tasks)
          .values(taskRows)
          .onConflictDoUpdate({
            target: tasks.id,
            set: {
              title: excluded('title'),
              position: excluded('position'),
              submissionType: excluded('submission_type'),
              present: true,
            },
          });
        await tx.delete(taskSkills);
        const links = [...this.tasks.values()].flatMap((t) =>
          t.skills.map((skillId) => ({ taskId: t.id, skillId })),
        );
        if (links.length > 0) await tx.insert(taskSkills).values(links);
      }

      // Removed files keep their rows (progress and submissions point at them)
      // but disappear from the plan.
      const keep = <T>(ids: T[]) => (ids.length > 0 ? ids : (['__none__'] as unknown as T[]));
      await tx
        .update(modules)
        .set({ present: false })
        .where(notInArray(modules.id, keep(moduleRows.map((m) => m.id))));
      await tx
        .update(lessons)
        .set({ present: false })
        .where(notInArray(lessons.id, keep(lessonRows.map((l) => l.id))));
      await tx
        .update(tasks)
        .set({ present: false })
        .where(notInArray(tasks.id, keep(taskRows.map((t) => t.id))));
    });
  }
}
