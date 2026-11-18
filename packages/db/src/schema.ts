import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Enums mirror the zod enums in @study/shared. Keep the two lists in sync.
export const moduleKind = pgEnum('module_kind', ['core', 'optional']);
export const effort = pgEnum('effort', ['S', 'M', 'L']);
export const progressStatus = pgEnum('progress_status', ['not_started', 'in_progress', 'done']);
export const submissionType = pgEnum('submission_type', ['repo', 'text', 'diagram']);
export const runStage = pgEnum('run_stage', ['checks', 'review']);
export const runStatus = pgEnum('run_status', [
  'queued',
  'running',
  'passed',
  'failed',
  'error',
  'not_run',
]);
export const reviewMode = pgEnum('review_mode', ['copy_paste', 'bridge', 'api']);
export const cardType = pgEnum('card_type', ['term', 'concept', 'cloze', 'comparison', 'snippet']);
export const cardSource = pgEnum('card_source', ['manual', 'lesson', 'claude']);
export const cardStatus = pgEnum('card_status', ['pending', 'active', 'suspended']);
export const grade = pgEnum('grade', ['again', 'hard', 'good', 'easy']);
export const cardState = pgEnum('card_state', ['new', 'learning', 'review', 'relearning']);
export const gradingMode = pgEnum('grading_mode', ['self', 'claude']);
export const activity = pgEnum('activity', ['lesson', 'task', 'review']);
export const reviewTaskStatus = pgEnum('review_task_status', ['open', 'done', 'dismissed']);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Curriculum. The content lives in files under curriculum/. These rows are an
// index of it, upserted by slug at start-up, so progress can reference it.
// ---------------------------------------------------------------------------

export const modules = pgTable('modules', {
  id: text('id').primaryKey(), // slug, e.g. "m03-postgres"
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  position: integer('position').notNull(),
  kind: moduleKind('kind').notNull(),
  effort: effort('effort').notNull(),
  services: text('services')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** False when the module's folder has been removed from curriculum/. */
  present: boolean('present').notNull().default(true),
  updatedAt,
});

export const lessons = pgTable(
  'lessons',
  {
    id: text('id').primaryKey(), // "<module>/<lesson>", e.g. "m03-postgres/l02-indexes"
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    present: boolean('present').notNull().default(true),
    updatedAt,
  },
  (t) => [index('lessons_module_idx').on(t.moduleId, t.position)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(), // "<module>/<task>"
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    submissionType: submissionType('submission_type').notNull(),
    present: boolean('present').notNull().default(true),
    updatedAt,
  },
  (t) => [index('tasks_module_idx').on(t.moduleId, t.position)],
);

export const skills = pgTable('skills', {
  id: text('id').primaryKey(), // slug, e.g. "sql-indexes"
  title: text('title').notNull(),
});

export const taskSkills = pgTable(
  'task_skills',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.skillId] })],
);

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export const lessonProgress = pgTable('lesson_progress', {
  lessonId: text('lesson_id')
    .primaryKey()
    .references(() => lessons.id, { onDelete: 'cascade' }),
  status: progressStatus('status').notNull().default('not_started'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  updatedAt,
});

export const studySessions = pgTable(
  'study_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    activity: activity('activity').notNull(),
    /** Lesson id, task id, or null for a card review session. */
    itemId: text('item_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Seconds the tab was active. Stored so idle time is not counted. */
    activeSeconds: integer('active_seconds').notNull().default(0),
  },
  (t) => [index('study_sessions_started_idx').on(t.startedAt)],
);

// ---------------------------------------------------------------------------
// Submissions and verification
// ---------------------------------------------------------------------------

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    type: submissionType('type').notNull(),
    /** Task folder inside the lab repo, relative to its root. Repo submissions only. */
    folder: text('folder'),
    commitSha: text('commit_sha'),
    /** Markdown answer. Text submissions only. */
    body: text('body'),
    /** Path under data/uploads. Diagram submissions only. */
    filePath: text('file_path'),
    createdAt,
  },
  (t) => [index('submissions_task_idx').on(t.taskId, t.createdAt)],
);

export const verificationRuns = pgTable(
  'verification_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    stage: runStage('stage').notNull(),
    status: runStatus('status').notNull().default('queued'),
    /** Review runs only. */
    mode: reviewMode('mode'),
    model: text('model'),
    prompt: text('prompt'),
    rawOutput: text('raw_output'),
    /** The review JSON after zod validation. */
    result: jsonb('result'),
    error: text('error'),
    durationMs: integer('duration_ms'),
    /** Only known for the API provider and for bridge runs that report it. */
    costUsd: doublePrecision('cost_usd'),
    createdAt,
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('verification_runs_submission_idx').on(t.submissionId, t.createdAt)],
);

export const checkResults = pgTable(
  'check_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => verificationRuns.id, { onDelete: 'cascade' }),
    criterionId: text('criterion_id').notNull(),
    title: text('title').notNull(),
    passed: boolean('passed').notNull(),
    log: text('log'),
  },
  (t) => [index('check_results_run_idx').on(t.runId)],
);

export const rubricScores = pgTable(
  'rubric_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => verificationRuns.id, { onDelete: 'cascade' }),
    rubricItemId: text('rubric_item_id').notNull(),
    skillId: text('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    score: integer('score').notNull(),
    maxScore: integer('max_score').notNull(),
    comment: text('comment'),
  },
  (t) => [
    index('rubric_scores_run_idx').on(t.runId),
    index('rubric_scores_skill_idx').on(t.skillId),
  ],
);

// ---------------------------------------------------------------------------
// Spaced repetition
// ---------------------------------------------------------------------------

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: cardType('type').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    source: cardSource('source').notNull(),
    status: cardStatus('status').notNull().default('active'),
    lessonId: text('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
    /** Stable key for lesson-deck cards ("<lesson>#<card id>"), so re-imports update in place. */
    sourceKey: text('source_key'),
    /** The review run that suggested this card, for Claude-suggested cards. */
    suggestedByRunId: uuid('suggested_by_run_id').references(() => verificationRuns.id, {
      onDelete: 'set null',
    }),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('cards_source_key_idx').on(t.sourceKey),
    index('cards_status_idx').on(t.status),
    index('cards_lesson_idx').on(t.lessonId),
  ],
);

export const cardSkills = pgTable(
  'card_skills',
  {
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.skillId] })],
);

/** Current FSRS state of a card. It can always be rebuilt by replaying `reviews`. */
export const cardSchedules = pgTable(
  'card_schedules',
  {
    cardId: uuid('card_id')
      .primaryKey()
      .references(() => cards.id, { onDelete: 'cascade' }),
    state: cardState('state').notNull().default('new'),
    due: timestamp('due', { withTimezone: true }).notNull().defaultNow(),
    stability: doublePrecision('stability').notNull().default(0),
    difficulty: doublePrecision('difficulty').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    lastReviewAt: timestamp('last_review_at', { withTimezone: true }),
    /** The full ts-fsrs card object, so fields the library adds later are not lost. */
    fsrs: jsonb('fsrs').notNull().default({}),
    updatedAt,
  },
  (t) => [index('card_schedules_due_idx').on(t.due)],
);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    grade: grade('grade').notNull(),
    /** Card state before this review. Retention only counts reviews made in the `review` state. */
    stateBefore: cardState('state_before').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
    answerMs: integer('answer_ms'),
    mode: gradingMode('mode').notNull().default('self'),
    /** The ts-fsrs review log, kept verbatim so the schedule can be replayed. */
    fsrsLog: jsonb('fsrs_log').notNull().default({}),
  },
  (t) => [
    index('reviews_card_idx').on(t.cardId, t.reviewedAt),
    index('reviews_at_idx').on(t.reviewedAt),
  ],
);

export const reviewTasks = pgTable(
  'review_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    status: reviewTaskStatus('status').notNull().default('open'),
    createdAt,
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('review_tasks_skill_idx').on(t.skillId, t.status)],
);

// ---------------------------------------------------------------------------
// Settings: a single row, id = 1.
// ---------------------------------------------------------------------------

export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  reviewMode: reviewMode('review_mode').notNull().default('copy_paste'),
  newCardsPerDay: integer('new_cards_per_day').notNull().default(10),
  reviewsPerDay: integer('reviews_per_day').notNull().default(100),
  desiredRetention: doublePrecision('desired_retention').notNull().default(0.9),
  labRepoPath: text('lab_repo_path'),
  updatedAt,
});
