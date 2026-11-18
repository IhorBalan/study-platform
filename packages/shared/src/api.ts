import { z } from 'zod';
import {
  Activity,
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
  /** `done` once the automated checks pass, or once an answer is saved for tasks without checks. */
  status: ProgressStatus,
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

const NextItem = z.object({ id: z.string(), title: z.string(), moduleTitle: z.string() });

/** What to do next. No dates: the platform is self-paced. */
export const NextUp = z.object({
  lesson: NextItem.nullable(),
  /** Tasks of modules the learner has started, not yet done. */
  tasks: z.array(NextItem.extend({ type: SubmissionType })),
  dueCards: z.number().int(),
  newCards: z.number().int(),
  pendingCards: z.number().int(),
  /** Skills whose recall has dropped, with the lesson to reread. */
  reviewTasks: z.array(
    z.object({
      id: z.string().uuid(),
      skillId: z.string(),
      skillTitle: z.string(),
      reason: z.string(),
      lessonId: z.string().nullable(),
    }),
  ),
});
export type NextUp = z.infer<typeof NextUp>;

export const PlanResponse = z.object({ modules: z.array(ModuleSummary), nextUp: NextUp });
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

/** Only what the platform can act on: the two review modes that exist and an absolute lab path. */
export const UpdateSettings = SettingsDto.extend({
  reviewMode: z.enum(['copy_paste', 'bridge']),
  labRepoPath: z
    .string()
    .trim()
    .max(1000)
    .regex(/^(\/|[A-Za-z]:[\\/])/, 'Use an absolute path, for example /Users/you/code/backend-lab')
    .nullable(),
}).partial();
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
  /** The latest review of this submission, if one was started. */
  review: z.lazy(() => ReviewDto).nullable(),
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
  /** True when the Claude CLI is installed on the host. */
  claude: z.boolean().default(false),
});
export type BridgeHealth = z.infer<typeof BridgeHealth>;

/** What the web app shows: whether the bridge can be reached, and what it reports. */
export const BridgeStatusResponse = z.object({
  reachable: z.boolean(),
  docker: z.boolean(),
  runners: z.array(z.string()),
  claude: z.boolean(),
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

export const RunReviewRequest = z.object({
  taskId: z.string().regex(/^m\d{2}-[a-z0-9-]+\/t\d{2}-[a-z0-9-]+$/),
  /** Needed for code tasks: Claude reads the task folder exported at this commit. */
  repoPath: z.string().min(1).optional(),
  commitSha: CommitSha.optional(),
  prompt: z.string().min(1).max(200_000),
});
export type RunReviewRequest = z.infer<typeof RunReviewRequest>;

export const RunReviewResponse = z.object({
  status: z.enum(['ok', 'error']),
  /** Why the review could not run, in words for the learner. */
  message: z.string().nullable(),
  /** Claude's reply: the JSON object as text. */
  output: z.string(),
  model: z.string().nullable(),
  costUsd: z.number().nullable(),
  durationMs: z.number().int(),
});
export type RunReviewResponse = z.infer<typeof RunReviewResponse>;

/** Queue the API fills and the worker drains. One job per automated check run. */
export const CHECKS_QUEUE = 'verification-checks';
export const ChecksJob = z.object({ runId: z.string().uuid() });
export type ChecksJob = z.infer<typeof ChecksJob>;

// ---------------------------------------------------------------------------
// Claude review (stage 2)
// ---------------------------------------------------------------------------

/** The JSON Claude must return. The same schema validates pasted and one-click output. */
export const ReviewResult = z.object({
  scores: z
    .array(
      z.object({
        rubricId: z.string().min(1),
        score: z.number().int().min(0),
        comment: z.string().trim().min(1).max(1500),
      }),
    )
    .min(1),
  strengths: z.array(z.string().trim().min(1).max(600)).max(8),
  issues: z
    .array(
      z.object({
        severity: z.enum(['high', 'medium', 'low']),
        message: z.string().trim().min(1).max(1500),
        file: z.string().max(300).nullish(),
        line: z.number().int().min(1).nullish(),
      }),
    )
    .max(20),
  securityConcerns: z.array(z.string().trim().min(1).max(800)).max(10),
  nextStep: z.string().trim().min(1).max(1000),
  suggestedCards: z
    .array(
      z.object({
        type: CardType,
        front: z.string().trim().min(1).max(600),
        back: z.string().trim().min(1).max(1200),
      }),
    )
    .max(5),
});
export type ReviewResult = z.infer<typeof ReviewResult>;

export const StartReview = z.object({
  mode: z.enum(['copy_paste', 'bridge']).default('copy_paste'),
});
export type StartReview = z.infer<typeof StartReview>;

export const ReviewDto = z.object({
  runId: z.string().uuid(),
  status: RunStatus,
  mode: ReviewMode,
  /** Why a one-click review failed. */
  error: z.string().nullable(),
  /** The text to give to Claude. */
  prompt: z.string(),
  result: ReviewResult.nullable(),
  /** Points per rubric item, with the maximum, once a result is stored. */
  scores: z.array(
    z.object({
      rubricId: z.string(),
      title: z.string(),
      score: z.number().int(),
      max: z.number().int(),
      comment: z.string().nullable(),
    }),
  ),
  /** How many suggested cards were added for approval. */
  cardsSuggested: z.number().int(),
  createdAt: z.string(),
});
export type ReviewDto = z.infer<typeof ReviewDto>;

export const SubmitReviewResult = z.object({
  /** Claude's reply as pasted. Text around the JSON is tolerated. */
  raw: z.string().trim().min(2).max(90_000),
});
export type SubmitReviewResult = z.infer<typeof SubmitReviewResult>;

// ---------------------------------------------------------------------------
// Time tracking and statistics
// ---------------------------------------------------------------------------

export const StartSession = z.object({
  activity: Activity,
  itemId: z.string().max(200).nullish(),
});
export type StartSession = z.infer<typeof StartSession>;

export const SessionDto = z.object({ id: z.string().uuid() });

/** Total seconds the tab has been active so far. Sent as a heartbeat. */
export const UpdateSession = z.object({
  activeSeconds: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600),
  ended: z.boolean().optional(),
});
export type UpdateSession = z.infer<typeof UpdateSession>;

export const StatsResponse = z.object({
  learning: z.object({
    /** Last 30 local days, oldest first. Days without study are included with zero. */
    secondsByDay: z.array(z.object({ day: z.string(), seconds: z.number().int() })),
    secondsByActivity: z.array(z.object({ activity: Activity, seconds: z.number().int() })),
    secondsByModule: z.array(
      z.object({ moduleId: z.string(), title: z.string(), seconds: z.number().int() }),
    ),
    totalSeconds: z.number().int(),
    lessonsDone: z.number().int(),
    lessonsTotal: z.number().int(),
    tasksDone: z.number().int(),
    tasksTotal: z.number().int(),
    /** Share of code tasks whose first submission passed the checks. Null without data. */
    firstAttemptPassRate: z.number().nullable(),
    averageAttemptsPerTask: z.number().nullable(),
    /** Consecutive days, ending today or yesterday, with any study activity. */
    studyStreakDays: z.number().int(),
    modules: z.array(
      z.object({
        moduleId: z.string(),
        title: z.string(),
        lessonsDone: z.number().int(),
        lessonsTotal: z.number().int(),
        tasksDone: z.number().int(),
        tasksTotal: z.number().int(),
      }),
    ),
    /** Average review score per skill, as a share of the maximum. */
    rubricBySkill: z.array(
      z.object({
        skillId: z.string(),
        title: z.string(),
        average: z.number(),
        reviews: z.number().int(),
      }),
    ),
  }),
  memory: z.object({
    dueToday: z.number().int(),
    reviewStreakDays: z.number().int(),
    /** Reviews of cards in the Review state not graded Again, over the last 30 days. */
    retention: z.number().nullable(),
    retentionReviews: z.number().int(),
    desiredRetention: z.number(),
    cardsByState: z.object({
      new: z.number().int(),
      learning: z.number().int(),
      young: z.number().int(),
      mature: z.number().int(),
      suspended: z.number().int(),
    }),
    weakestSkills: z.array(
      z.object({
        skillId: z.string(),
        title: z.string(),
        retention: z.number(),
        reviews: z.number().int(),
        weak: z.boolean(),
      }),
    ),
  }),
});
export type StatsResponse = z.infer<typeof StatsResponse>;

// ---------------------------------------------------------------------------
// Search

export const SearchQuery = z.object({ q: z.string().trim().max(100).default('') });
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchResult = z.object({
  kind: z.enum(['lesson', 'task']),
  /** "<module>/<slug>", which is also the URL path of the lesson or task. */
  id: z.string(),
  title: z.string(),
  moduleTitle: z.string(),
  /** A short piece of the text around the first match. Empty when only the title matched. */
  snippet: z.string(),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResponse = z.object({
  query: z.string(),
  results: z.array(SearchResult),
});
export type SearchResponse = z.infer<typeof SearchResponse>;
