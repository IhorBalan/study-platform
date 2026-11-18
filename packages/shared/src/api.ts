import { z } from 'zod';
import { Effort, ModuleKind, ProgressStatus } from './enums.js';

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
