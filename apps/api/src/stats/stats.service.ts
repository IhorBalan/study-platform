import { Injectable } from '@nestjs/common';
import type { StatsResponse } from '@study/shared';
import { sql } from 'drizzle-orm';
import { CurriculumService } from '../curriculum/curriculum.service.js';
import { InjectDb, type Database } from '../database/database.module.js';
import { PlanService } from '../plan/plan.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { addLocalDays, localDayKey, localDayKeys, startOfLocalDay } from '../srs/time.js';
import { WeakSkillsService } from './weak-skills.service.js';

/** Cards with an interval of three weeks or more count as mature, as in Anki. */
const MATURE_DAYS = 21;

/** How many days ahead the Stats page shows cards coming due. */
const FORECAST_DAYS = 14;

/** Counts consecutive days with activity, ending today or yesterday. */
export function streak(activeDays: Set<string>, now: Date): number {
  const cursor = startOfLocalDay(now);
  if (!activeDays.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let days = 0;
  while (activeDays.has(localDayKey(cursor))) {
    days += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

@Injectable()
export class StatsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly curriculum: CurriculumService,
    private readonly plan: PlanService,
    private readonly settings: SettingsService,
    private readonly weakSkills: WeakSkillsService,
  ) {}

  async get(now = new Date()): Promise<StatsResponse> {
    const today = startOfLocalDay(now);
    // Calendar steps, not multiples of 24 hours: a daylight saving change makes a day 23 or 25 hours long.
    const windowStart = addLocalDays(today, -29);
    const yearAgo = addLocalDays(today, -365);

    const sessions = await this.db.execute<{
      activity: 'lesson' | 'task' | 'review';
      item_id: string | null;
      started_at: Date;
      active_seconds: number;
    }>(sql`
      select activity, item_id, started_at, active_seconds
      from study_sessions where active_seconds > 0 and started_at >= ${yearAgo}
    `);
    const reviewDays = await this.db.execute<{ reviewed_at: Date }>(sql`
      select reviewed_at from reviews where reviewed_at >= ${yearAgo}
    `);

    const byDay = new Map<string, number>();
    for (const key of localDayKeys(windowStart, 30)) byDay.set(key, 0);
    const byActivity = new Map<string, number>();
    const byModule = new Map<string, number>();
    const studyDays = new Set<string>();
    let totalSeconds = 0;
    for (const s of sessions.rows) {
      const started = new Date(s.started_at);
      const key = localDayKey(started);
      studyDays.add(key);
      totalSeconds += s.active_seconds;
      if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + s.active_seconds);
      byActivity.set(s.activity, (byActivity.get(s.activity) ?? 0) + s.active_seconds);
      const moduleId = s.item_id?.split('/')[0];
      if (moduleId) byModule.set(moduleId, (byModule.get(moduleId) ?? 0) + s.active_seconds);
    }
    const reviewDaySet = new Set(reviewDays.rows.map((r) => localDayKey(new Date(r.reviewed_at))));
    for (const day of reviewDaySet) studyDays.add(day);

    const { modules } = await this.plan.getPlan(now);
    const moduleStats = modules.map((m) => ({
      moduleId: m.id,
      title: m.title,
      lessonsDone: m.lessons.filter((l) => l.status === 'done').length,
      lessonsTotal: m.lessons.length,
      tasksDone: m.tasks.filter((t) => t.status === 'done').length,
      tasksTotal: m.tasks.length,
    }));
    const sum = (pick: (m: (typeof moduleStats)[number]) => number) =>
      moduleStats.reduce((total, m) => total + pick(m), 0);

    // Attempts per code task: how many submissions it took until the checks first passed.
    const attempts = await this.db.execute<{ first_passed: boolean; attempts: number }>(sql`
      with ranked as (
        select s.task_id, r.status,
               row_number() over (partition by s.task_id order by s.created_at) as n
        from submissions s
        join verification_runs r on r.submission_id = s.id and r.stage = 'checks'
        where r.status in ('passed', 'failed')
      ),
      first_pass as (
        select task_id, min(n) as n from ranked where status = 'passed' group by task_id
      )
      select (n = 1) as first_passed, n::int as attempts from first_pass
    `);
    const passed = attempts.rows;

    const rubric = await this.db.execute<{
      skill_id: string;
      title: string;
      average: number;
      reviews: number;
    }>(sql`
      select s.id as skill_id, s.title,
             avg(rs.score::float / rs.max_score) as average, count(*)::int as reviews
      from rubric_scores rs join skills s on s.id = rs.skill_id
      group by s.id, s.title order by average asc
    `);

    const states = await this.db.execute<{ bucket: string; n: number }>(sql`
      select case
               when c.status = 'suspended' then 'suspended'
               when cs.state = 'new' then 'new'
               when cs.state in ('learning', 'relearning') then 'learning'
               when cs.due - cs.last_review_at >= make_interval(days => ${MATURE_DAYS}) then 'mature'
               else 'young'
             end as bucket, count(*)::int as n
      from cards c join card_schedules cs on cs.card_id = c.id
      where c.status <> 'pending'
      group by 1
    `);
    const cardsByState = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
    for (const row of states.rows) {
      if (row.bucket in cardsByState) cardsByState[row.bucket as keyof typeof cardsByState] = row.n;
    }

    const endOfToday = addLocalDays(today, 1);
    const due = await this.db.execute<{ n: number }>(sql`
      select count(*)::int as n from cards c join card_schedules cs on cs.card_id = c.id
      where c.status = 'active' and cs.state <> 'new' and cs.due < ${endOfToday}
    `);
    const horizon = addLocalDays(today, FORECAST_DAYS);
    const upcoming = await this.db.execute<{ due: Date }>(sql`
      select cs.due from cards c join card_schedules cs on cs.card_id = c.id
      where c.status = 'active' and cs.state <> 'new' and cs.due < ${horizon}
    `);
    const dueByDay = new Map<string, number>();
    for (const key of localDayKeys(today, FORECAST_DAYS)) dueByDay.set(key, 0);
    const todayKey = localDayKey(today);
    for (const row of upcoming.rows) {
      const due = new Date(row.due);
      // Overdue cards are today's work.
      const key = due < today ? todayKey : localDayKey(due);
      if (dueByDay.has(key)) dueByDay.set(key, (dueByDay.get(key) ?? 0) + 1);
    }
    const retention = await this.db.execute<{ reviews: number; kept: number }>(sql`
      select count(*)::int as reviews, count(*) filter (where grade <> 'again')::int as kept
      from reviews where state_before = 'review' and reviewed_at >= ${windowStart}
    `);
    const kept = retention.rows[0] ?? { reviews: 0, kept: 0 };
    const { desiredRetention } = await this.settings.get();
    const skills = await this.weakSkills.retentionBySkill(now);

    return {
      learning: {
        secondsByDay: [...byDay].map(([day, seconds]) => ({ day, seconds })),
        secondsByActivity: (['lesson', 'task', 'review'] as const).map((activity) => ({
          activity,
          seconds: byActivity.get(activity) ?? 0,
        })),
        secondsByModule: [...byModule]
          .filter(([id]) => modules.some((m) => m.id === id))
          .map(([moduleId, seconds]) => ({
            moduleId,
            title: this.curriculum.module(moduleId).title,
            seconds,
          })),
        totalSeconds,
        lessonsDone: sum((m) => m.lessonsDone),
        lessonsTotal: sum((m) => m.lessonsTotal),
        tasksDone: sum((m) => m.tasksDone),
        tasksTotal: sum((m) => m.tasksTotal),
        firstAttemptPassRate:
          passed.length > 0 ? passed.filter((p) => p.first_passed).length / passed.length : null,
        averageAttemptsPerTask:
          passed.length > 0 ? passed.reduce((t, p) => t + p.attempts, 0) / passed.length : null,
        studyStreakDays: streak(studyDays, now),
        modules: moduleStats,
        rubricBySkill: rubric.rows.map((r) => ({
          skillId: r.skill_id,
          title: r.title,
          average: Number(r.average),
          reviews: r.reviews,
        })),
      },
      memory: {
        dueToday: due.rows[0]?.n ?? 0,
        dueByDay: [...dueByDay].map(([day, n]) => ({ day, cards: n })),
        reviewStreakDays: streak(reviewDaySet, now),
        retention: kept.reviews > 0 ? kept.kept / kept.reviews : null,
        retentionReviews: kept.reviews,
        desiredRetention,
        cardsByState,
        weakestSkills: skills
          .filter((s) => s.reviews >= 3)
          .sort((a, b) => a.retention - b.retention)
          .slice(0, 8)
          .map(({ skillId, title, retention: r, reviews, weak }) => ({
            skillId,
            title,
            retention: r,
            reviews,
            weak,
          })),
      },
    };
  }
}
