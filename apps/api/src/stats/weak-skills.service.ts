import { Injectable } from '@nestjs/common';
import { schema } from '@study/db';
import { and, eq, sql } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';

const { reviewTasks } = schema;

export const WEAK_WINDOW_DAYS = 30;
export const WEAK_MIN_REVIEWS = 10;
/** A skill is weak when its retention is this far below the desired retention. */
export const WEAK_MARGIN = 0.1;

export interface SkillRetention {
  skillId: string;
  title: string;
  reviews: number;
  retention: number;
  weak: boolean;
}

@Injectable()
export class WeakSkillsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Retention per skill over the last 30 days. Only reviews made while the
   * card was in the Review state count, as in Anki's "true retention".
   */
  async retentionBySkill(now = new Date()): Promise<SkillRetention[]> {
    const since = new Date(now.getTime() - WEAK_WINDOW_DAYS * 86_400_000);
    const { desiredRetention } = await this.settings.get();
    const result = await this.db.execute<{
      skill_id: string;
      title: string;
      reviews: number;
      kept: number;
    }>(sql`
      select s.id as skill_id, s.title,
             count(*)::int as reviews,
             count(*) filter (where r.grade <> 'again')::int as kept
      from reviews r
      join card_skills cs on cs.card_id = r.card_id
      join skills s on s.id = cs.skill_id
      where r.state_before = 'review' and r.reviewed_at >= ${since}
      group by s.id, s.title
    `);
    return result.rows.map((row) => {
      const retention = row.kept / row.reviews;
      return {
        skillId: row.skill_id,
        title: row.title,
        reviews: row.reviews,
        retention,
        weak: row.reviews >= WEAK_MIN_REVIEWS && retention < desiredRetention - WEAK_MARGIN,
      };
    });
  }

  /** Opens a review task for each newly weak skill and closes those that have recovered. */
  async evaluate(now = new Date()): Promise<void> {
    const skills = await this.retentionBySkill(now);
    const weak = new Map(skills.filter((s) => s.weak).map((s) => [s.skillId, s]));
    const open = await this.db.select().from(reviewTasks).where(eq(reviewTasks.status, 'open'));

    for (const task of open) {
      if (!weak.has(task.skillId)) {
        await this.db
          .update(reviewTasks)
          .set({ status: 'done', closedAt: now })
          .where(and(eq(reviewTasks.id, task.id), eq(reviewTasks.status, 'open')));
      }
    }
    const alreadyOpen = new Set(open.map((t) => t.skillId));
    for (const skill of weak.values()) {
      if (alreadyOpen.has(skill.skillId)) continue;
      await this.db
        .insert(reviewTasks)
        .values({
          skillId: skill.skillId,
          reason: `You remembered ${Math.round(skill.retention * 100)}% of ${skill.reviews} reviews in the last ${WEAK_WINDOW_DAYS} days.`,
        })
        // Another evaluation may have opened it in the meantime.
        .onConflictDoNothing();
    }
  }

  async dismiss(id: string): Promise<boolean> {
    const rows = await this.db
      .update(reviewTasks)
      .set({ status: 'dismissed', closedAt: new Date() })
      .where(and(eq(reviewTasks.id, id), eq(reviewTasks.status, 'open')))
      .returning({ id: reviewTasks.id });
    return rows.length > 0;
  }
}
