import { z } from 'zod';
import {
  CardSource,
  CardState,
  CardStatus,
  CardType,
  Effort,
  Grade,
  ModuleKind,
  ProgressStatus,
  ReviewMode,
  RunStage,
  RunStatus,
  SubmissionType,
} from './enums.js';

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const LessonSummary = z.object({
  id: z.string(),
  title: z.string(),
  position: z.number().int(),
  status: ProgressStatus,
});
export type LessonSummary = z.infer<typeof LessonSummary>;

export const TaskSummary = z.object({
  id: z.string(),
  title: z.string(),
  position: z.number().int(),
  type: SubmissionType,
});
export type TaskSummary = z.infer<typeof TaskSummary>;

export const ModuleSummary = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  position: z.number().int(),
  kind: ModuleKind,
  effort: Effort,
  /** Practice services the module's tasks need, e.g. `postgres`, `valkey`, `aws`. */
  services: z.array(z.string()),
  lessons: z.array(LessonSummary),
  tasks: z.array(TaskSummary),
});
export type ModuleSummary = z.infer<typeof ModuleSummary>;

export const PlanResponse = z.object({ modules: z.array(ModuleSummary) });
export type PlanResponse = z.infer<typeof PlanResponse>;

/** RFC 9457 problem details: the error format every endpoint returns. */
export const ProblemDetails = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;

export const LessonRef = z.object({ id: z.string(), title: z.string() });
export type LessonRef = z.infer<typeof LessonRef>;

export const LessonDetail = z.object({
  id: z.string(),
  moduleId: z.string(),
  moduleTitle: z.string(),
  title: z.string(),
  markdown: z.string(),
  status: ProgressStatus,
  /** Size of the curated deck that joins the review queue when the lesson is completed. */
  cardCount: z.number().int(),
  previous: LessonRef.nullable(),
  next: LessonRef.nullable(),
});
export type LessonDetail = z.infer<typeof LessonDetail>;

export const UpdateLessonProgress = z.object({ status: ProgressStatus });
export type UpdateLessonProgress = z.infer<typeof UpdateLessonProgress>;

export const LessonProgressResponse = z.object({
  status: ProgressStatus,
  /** Cards added to the deck by this update. Non-zero only the first time a lesson is completed. */
  cardsAdded: z.number().int(),
});
export type LessonProgressResponse = z.infer<typeof LessonProgressResponse>;

export const TaskDetail = z.object({
  id: z.string(),
  moduleId: z.string(),
  moduleTitle: z.string(),
  title: z.string(),
  type: SubmissionType,
  markdown: z.string(),
  hints: z.array(z.string()),
  services: z.array(z.string()),
  criteria: z.array(z.object({ id: z.string(), title: z.string() })),
  rubric: z.array(z.object({ id: z.string(), title: z.string(), max: z.number().int() })),
  /** Where the task lives inside the learner's lab repository. */
  labFolder: z.string(),
  /** True when the task has an automated check suite (stage 1). */
  hasChecks: z.boolean(),
});
export type TaskDetail = z.infer<typeof TaskDetail>;

// ---------------------------------------------------------------------------
// Spaced repetition
// ---------------------------------------------------------------------------

export const CardDto = z.object({
  id: z.string().uuid(),
  type: CardType,
  front: z.string(),
  back: z.string(),
  source: CardSource,
  status: CardStatus,
  lessonId: z.string().nullable(),
  skills: z.array(z.string()),
  state: CardState,
  due: z.string(),
  reps: z.number().int(),
  lapses: z.number().int(),
});
export type CardDto = z.infer<typeof CardDto>;

export const CreateCard = z.object({
  type: CardType,
  front: z.string().trim().min(1).max(2000),
  back: z.string().trim().min(1).max(4000),
  lessonId: z.string().optional(),
  skills: z.array(z.string()).max(10).default([]),
});
export type CreateCard = z.infer<typeof CreateCard>;

export const UpdateCard = z
  .object({
    type: CardType,
    front: z.string().trim().min(1).max(2000),
    back: z.string().trim().min(1).max(4000),
    /** `pending` -> `active` approves a suggested card. */
    status: CardStatus,
  })
  .partial();
export type UpdateCard = z.infer<typeof UpdateCard>;

export const CardListResponse = z.object({ cards: z.array(CardDto) });
export type CardListResponse = z.infer<typeof CardListResponse>;

/** A due card, with what each grade would do to it. */
export const QueueCard = CardDto.extend({
  /** Next due date per grade, so the buttons can show "Good · 4d". */
  preview: z.record(Grade, z.string()),
});
export type QueueCard = z.infer<typeof QueueCard>;

export const ReviewQueueResponse = z.object({
  cards: z.array(QueueCard),
  counts: z.object({
    /** Cards already seen that are due now. */
    due: z.number().int(),
    /** New cards still allowed today under the daily limit. */
    newAvailable: z.number().int(),
    reviewedToday: z.number().int(),
    pendingApproval: z.number().int(),
  }),
});
export type ReviewQueueResponse = z.infer<typeof ReviewQueueResponse>;

export const SubmitReview = z.object({
  grade: Grade,
  /** Time from showing the front to grading, in milliseconds. */
  answerMs: z.number().int().min(0).max(3_600_000).optional(),
});
export type SubmitReview = z.infer<typeof SubmitReview>;

export const SubmitReviewResponse = z.object({
  state: CardState,
  due: z.string(),
});
export type SubmitReviewResponse = z.infer<typeof SubmitReviewResponse>;

export const SettingsDto = z.object({
  reviewMode: ReviewMode,
  newCardsPerDay: z.number().int().min(0).max(200),
  reviewsPerDay: z.number().int().min(1).max(2000),
  desiredRetention: z.number().min(0.7).max(0.97),
  labRepoPath: z.string().nullable(),
});
export type SettingsDto = z.infer<typeof SettingsDto>;

export const UpdateSettings = SettingsDto.partial();
export type UpdateSettings = z.infer<typeof UpdateSettings>;

// ---------------------------------------------------------------------------
// Submissions and automated checks
// ---------------------------------------------------------------------------

/** A full or abbreviated commit id. Empty means "the latest commit". */
const CommitSha = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, 'Use a commit id of 7 to 40 hex characters');

export const CreateSubmission = z.discriminatedUnion('type', [
  z.object({ type: z.literal('repo'), commitSha: CommitSha.optional() }),
  z.object({ type: z.literal('text'), body: z.string().trim().min(1).max(50_000) }),
]);
export type CreateSubmission = z.infer<typeof CreateSubmission>;

export const CheckResultDto = z.object({
  criterionId: z.string(),
  title: z.string(),
  passed: z.boolean(),
  log: z.string().nullable(),
});
export type CheckResultDto = z.infer<typeof CheckResultDto>;

export const RunDto = z.object({
  id: z.string().uuid(),
  stage: RunStage,
  status: RunStatus,
  /** Why a run could not start or finish, in words for the learner. */
  error: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  checks: z.array(CheckResultDto),
});
export type RunDto = z.infer<typeof RunDto>;

export const SubmissionDto = z.object({
  id: z.string().uuid(),
  taskId: z.string(),
  type: SubmissionType,
  commitSha: z.string().nullable(),
  body: z.string().nullable(),
  createdAt: z.string(),
  runs: z.array(RunDto),
});
export type SubmissionDto = z.infer<typeof SubmissionDto>;

export const SubmissionListResponse = z.object({ submissions: z.array(SubmissionDto) });
export type SubmissionListResponse = z.infer<typeof SubmissionListResponse>;

// ---------------------------------------------------------------------------
// Host bridge (the only process that may start containers or run the Claude CLI)
// ---------------------------------------------------------------------------

export const BridgeHealth = z.object({
  status: z.literal('ok'),
  docker: z.boolean(),
  /** Runner images that are built and ready, e.g. ["node", "nest"]. */
  runners: z.array(z.string()),
});
export type BridgeHealth = z.infer<typeof BridgeHealth>;

/** What the web app shows: whether the bridge can be reached, and what it reports. */
export const BridgeStatusResponse = z.object({
  reachable: z.boolean(),
  docker: z.boolean(),
  runners: z.array(z.string()),
});
export type BridgeStatusResponse = z.infer<typeof BridgeStatusResponse>;

export const RunChecksRequest = z.object({
  taskId: z.string().regex(/^m\d{2}-[a-z0-9-]+\/t\d{2}-[a-z0-9-]+$/),
  /** Absolute path of the learner's lab repository on the host. */
  repoPath: z.string().min(1),
  /** Omitted means the latest commit on the checked-out branch. */
  commitSha: CommitSha.optional(),
});
export type RunChecksRequest = z.infer<typeof RunChecksRequest>;

export const RunChecksResponse = z.object({
  /** `error` means the checks could not run at all; `message` says why. */
  status: z.enum(['passed', 'failed', 'error']),
  message: z.string().nullable(),
  /** The commit that was checked, resolved to its full id. */
  commitSha: z.string().nullable(),
  results: z.array(CheckResultDto),
  /** Tail of the check output, for the learner to read. */
  log: z.string(),
  durationMs: z.number().int(),
});
export type RunChecksResponse = z.infer<typeof RunChecksResponse>;

/** Queue the API fills and the worker drains. One job per automated check run. */
export const CHECKS_QUEUE = 'verification-checks';
export const ChecksJob = z.object({ runId: z.string().uuid() });
export type ChecksJob = z.infer<typeof ChecksJob>;
