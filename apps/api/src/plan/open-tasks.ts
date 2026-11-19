import type { ModuleSummary, NextUp } from '@study/shared';

/** Next up is a short list of what to do now. The Plan below it lists every task. */
export const MAX_NEXT_TASKS = 3;

/**
 * The open tasks to offer under "Next up".
 *
 * A module counts once the learner works in it: it holds the next lesson, one of
 * its lessons is done, or one of its tasks was submitted. Opening a lesson from a
 * search result is not enough, or one look into another module would add all of
 * that module's tasks. Tasks already started come first, so the cap never hides them.
 */
export function openTasksForNextUp(
  modules: ModuleSummary[],
  nextLessonId: string | null,
): NextUp['tasks'] {
  const active = modules.filter(
    (m) =>
      m.lessons.some((l) => l.id === nextLessonId || l.status === 'done') ||
      m.tasks.some((t) => t.status !== 'not_started'),
  );
  const open = active.flatMap((m) =>
    m.tasks.filter((t) => t.status !== 'done').map((t) => ({ task: t, moduleTitle: m.title })),
  );
  return [
    ...open.filter(({ task }) => task.status === 'in_progress'),
    ...open.filter(({ task }) => task.status !== 'in_progress'),
  ]
    .slice(0, MAX_NEXT_TASKS)
    .map(({ task, moduleTitle }) => ({
      id: task.id,
      title: task.title,
      moduleTitle,
      type: task.type,
    }));
}
