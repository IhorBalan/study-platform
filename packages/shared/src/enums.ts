import { z } from 'zod';

/** Core modules form the recommended path; optional ones can be skipped. */
export const ModuleKind = z.enum(['core', 'optional']);
export type ModuleKind = z.infer<typeof ModuleKind>;

/** Relative effort. There are no week estimates: the platform is self-paced. */
export const Effort = z.enum(['S', 'M', 'L']);
export type Effort = z.infer<typeof Effort>;

export const ProgressStatus = z.enum(['not_started', 'in_progress', 'done']);
export type ProgressStatus = z.infer<typeof ProgressStatus>;

export const SubmissionType = z.enum(['repo', 'text', 'diagram']);
export type SubmissionType = z.infer<typeof SubmissionType>;

export const RunStage = z.enum(['checks', 'review']);
export type RunStage = z.infer<typeof RunStage>;

export const RunStatus = z.enum(['queued', 'running', 'passed', 'failed', 'error', 'not_run']);
export type RunStatus = z.infer<typeof RunStatus>;

/** How a Claude review was obtained. `api` is reserved; it is not built in the MVP. */
export const ReviewMode = z.enum(['copy_paste', 'bridge', 'api']);
export type ReviewMode = z.infer<typeof ReviewMode>;

export const CardType = z.enum(['term', 'concept', 'cloze', 'comparison', 'snippet']);
export type CardType = z.infer<typeof CardType>;

export const CardSource = z.enum(['manual', 'lesson', 'claude']);
export type CardSource = z.infer<typeof CardSource>;

export const CardStatus = z.enum(['pending', 'active', 'suspended']);
export type CardStatus = z.infer<typeof CardStatus>;

/** FSRS grades, in the order ts-fsrs numbers them (1-4). */
export const Grade = z.enum(['again', 'hard', 'good', 'easy']);
export type Grade = z.infer<typeof Grade>;

export const CardState = z.enum(['new', 'learning', 'review', 'relearning']);
export type CardState = z.infer<typeof CardState>;

export const GradingMode = z.enum(['self', 'claude']);
export type GradingMode = z.infer<typeof GradingMode>;

export const Activity = z.enum(['lesson', 'task', 'review']);
export type Activity = z.infer<typeof Activity>;
