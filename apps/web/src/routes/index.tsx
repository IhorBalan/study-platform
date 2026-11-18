import type { ModuleSummary, NextUp } from '@study/shared';
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { api } from '../lib/api';

const planQuery = queryOptions({ queryKey: ['plan'], queryFn: api.plan });

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(planQuery),
  component: PlanPage,
  errorComponent: ({ error }) => (
    <p role="alert" className="text-sm text-red-600">
      Could not load the plan: {error instanceof Error ? error.message : String(error)}
    </p>
  ),
});

function PlanPage() {
  const { data } = useSuspenseQuery(planQuery);

  return (
    <section>
      <h1 className="text-2xl font-semibold">Plan</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        A recommended order, not a schedule. Go deeper or skip optional modules as you like.
      </p>

      {data.modules.length > 0 && <NextUpPanel nextUp={data.nextUp} />}

      {data.modules.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
          No modules loaded yet. Add content under <code className="font-mono">curriculum/</code>{' '}
          and restart the API.
        </p>
      ) : (
        <ol className="mt-6 space-y-3" aria-label="Modules">
          {data.modules.map((m) => (
            <ModuleRow key={m.id} module={m} />
          ))}
        </ol>
      )}
    </section>
  );
}

const statusDot = {
  done: 'bg-emerald-500',
  in_progress: 'bg-amber-400',
  not_started: 'bg-zinc-300 dark:bg-zinc-700',
} as const;

const splitId = (id: string) => {
  const [moduleId = '', slug = ''] = id.split('/');
  return { moduleId, slug };
};

function NextUpPanel({ nextUp }: { nextUp: NextUp }) {
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismissReviewTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan'] }),
  });
  const cards = nextUp.dueCards + nextUp.newCards;
  const nothing =
    !nextUp.lesson && nextUp.tasks.length === 0 && cards === 0 && nextUp.reviewTasks.length === 0;

  return (
    <section
      aria-labelledby="next-up"
      className="mt-6 rounded-lg border border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <h2 id="next-up" className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Next up
      </h2>
      {nothing ? (
        <p className="mt-2 text-sm">Everything is done. Nothing is due.</p>
      ) : (
        <ul className="mt-2 grid gap-2 text-sm">
          {cards > 0 && (
            <li>
              <Link to="/review" className="font-medium hover:underline">
                Review cards
              </Link>{' '}
              <span className="text-zinc-500 dark:text-zinc-400">
                {nextUp.dueCards} due, {nextUp.newCards} new
              </span>
            </li>
          )}
          {nextUp.reviewTasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-baseline gap-x-2">
              <span>
                Refresh{' '}
                {task.lessonId ? (
                  <Link
                    to="/lessons/$moduleId/$lessonSlug"
                    params={{
                      moduleId: splitId(task.lessonId).moduleId,
                      lessonSlug: splitId(task.lessonId).slug,
                    }}
                    className="font-medium hover:underline"
                  >
                    {task.skillTitle}
                  </Link>
                ) : (
                  <span className="font-medium">{task.skillTitle}</span>
                )}
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">{task.reason}</span>
              <button
                type="button"
                className="text-xs text-zinc-500 underline"
                onClick={() => dismiss.mutate(task.id)}
              >
                Dismiss
              </button>
            </li>
          ))}
          {nextUp.lesson && (
            <li>
              <Link
                to="/lessons/$moduleId/$lessonSlug"
                params={{
                  moduleId: splitId(nextUp.lesson.id).moduleId,
                  lessonSlug: splitId(nextUp.lesson.id).slug,
                }}
                className="font-medium hover:underline"
              >
                {nextUp.lesson.title}
              </Link>{' '}
              <span className="text-zinc-500 dark:text-zinc-400">
                Lesson · {nextUp.lesson.moduleTitle}
              </span>
            </li>
          )}
          {nextUp.tasks.map((task) => (
            <li key={task.id}>
              <Link
                to="/tasks/$moduleId/$taskSlug"
                params={{ moduleId: splitId(task.id).moduleId, taskSlug: splitId(task.id).slug }}
                className="font-medium hover:underline"
              >
                {task.title}
              </Link>{' '}
              <span className="text-zinc-500 dark:text-zinc-400">Task · {task.moduleTitle}</span>
            </li>
          ))}
          {nextUp.pendingCards > 0 && (
            <li>
              <Link to="/cards" className="font-medium hover:underline">
                Approve suggested cards
              </Link>{' '}
              <span className="text-zinc-500 dark:text-zinc-400">
                {nextUp.pendingCards} waiting
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function ModuleRow({ module: m }: { module: ModuleSummary }) {
  const done = m.lessons.filter((l) => l.status === 'done').length;
  return (
    <li className="min-w-0 rounded-lg border border-zinc-200 p-4 break-words dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="min-w-0 font-medium [overflow-wrap:anywhere]">{m.title}</h2>
        <div className="flex gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{m.kind === 'core' ? 'Core' : 'Optional'}</span>
          <span aria-label={`Effort ${m.effort}`}>Effort {m.effort}</span>
          <span>
            {done}/{m.lessons.length} lessons
          </span>
        </div>
      </div>
      {m.summary && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{m.summary}</p>}
      {m.services.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Practice services: {m.services.join(', ')}
        </p>
      )}
      {(m.lessons.length > 0 || m.tasks.length > 0) && (
        <details className="mt-3 text-sm" open={done > 0 && done < m.lessons.length}>
          <summary className="cursor-pointer text-zinc-600 dark:text-zinc-300">
            {m.lessons.length} lessons, {m.tasks.length} tasks
          </summary>
          <ol className="mt-2 space-y-1">
            {m.lessons.map((l) => {
              const [moduleId = '', lessonSlug = ''] = l.id.split('/');
              return (
                <li key={l.id} className="flex items-center gap-2">
                  <span
                    aria-label={l.status.replace('_', ' ')}
                    className={`size-2 shrink-0 rounded-full ${
                      l.status === 'done'
                        ? 'bg-emerald-500'
                        : l.status === 'in_progress'
                          ? 'bg-amber-400'
                          : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                  />
                  <Link
                    to="/lessons/$moduleId/$lessonSlug"
                    params={{ moduleId, lessonSlug }}
                    className="hover:underline"
                  >
                    {l.title}
                  </Link>
                </li>
              );
            })}
            {m.tasks.map((t) => {
              const [moduleId = '', taskSlug = ''] = t.id.split('/');
              return (
                <li key={t.id} className="flex items-center gap-2">
                  <span
                    aria-label={t.status.replace('_', ' ')}
                    className={`size-2 shrink-0 rounded-full ${statusDot[t.status]}`}
                  />
                  <span className="rounded border border-zinc-300 px-1 text-[10px] uppercase text-zinc-500 dark:border-zinc-700">
                    {t.type === 'repo' ? 'Code' : t.type === 'text' ? 'Write' : 'Draw'}
                  </span>
                  <Link
                    to="/tasks/$moduleId/$taskSlug"
                    params={{ moduleId, taskSlug }}
                    className="hover:underline"
                  >
                    {t.title}
                  </Link>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </li>
  );
}
