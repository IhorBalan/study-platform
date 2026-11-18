import { CardType, Effort, ModuleKind, SubmissionType } from '@study/shared';
import { z } from 'zod';

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lower-case letters, digits and single hyphens');

/** `module.yaml` */
export const ModuleFile = z.strictObject({
  title: z.string().min(1),
  summary: z.string().min(1),
  kind: ModuleKind,
  effort: Effort,
  /** Practice services the tasks need. Empty means reading and flashcards only. */
  services: z.array(slug).default([]),
  /** Skills introduced by this module. Lessons, cards and tasks refer to them by id. */
  skills: z.array(z.strictObject({ id: slug, title: z.string().min(1) })).default([]),
});
export type ModuleFile = z.infer<typeof ModuleFile>;

/** Front matter of `lesson.md` */
export const LessonMeta = z.strictObject({
  title: z.string().min(1),
  skills: z.array(slug).default([]),
});
export type LessonMeta = z.infer<typeof LessonMeta>;

/** `cards.yaml`: the curated deck that ships with a lesson. */
export const CardFile = z.array(
  z.strictObject({
    /** Stable within the lesson. Renaming it creates a new card. */
    id: slug,
    type: CardType,
    front: z.string().min(1),
    back: z.string().min(1),
    skills: z.array(slug).default([]),
  }),
);
export type CardFile = z.infer<typeof CardFile>;

/** `task.yaml`. The task description itself is Markdown in `task.md`. */
export const TaskFile = z.strictObject({
  title: z.string().min(1),
  type: SubmissionType,
  skills: z.array(slug).default([]),
  services: z.array(slug).default([]),
  /**
   * Sandbox image the checks run in. `node` has Node only. `nest` adds the
   * NestJS packages listed in infra/docker/runner-nest/package.json, because
   * the sandbox has no internet and cannot install anything.
   */
  runner: z.enum(['node', 'nest']).default('node'),
  hints: z.array(z.string().min(1)).default([]),
  /** What stage 1 checks. Each id must match a result the check suite reports. */
  criteria: z.array(z.strictObject({ id: slug, title: z.string().min(1) })).default([]),
  /** What Claude scores in stage 2. */
  rubric: z
    .array(
      z.strictObject({
        id: slug,
        title: z.string().min(1),
        skill: slug.optional(),
        max: z.number().int().min(1).max(10).default(4),
      }),
    )
    .min(1),
  /** Sandbox overrides for this task. */
  limits: z
    .strictObject({
      memoryMb: z.number().int().min(64).max(4096).optional(),
      cpus: z.number().min(0.25).max(4).optional(),
      timeoutSeconds: z.number().int().min(5).max(900).optional(),
    })
    .default({}),
});
export type TaskFile = z.infer<typeof TaskFile>;
