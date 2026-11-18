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
