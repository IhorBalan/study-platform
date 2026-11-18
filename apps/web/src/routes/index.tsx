import type { ModuleSummary, NextUp } from '@study/shared';
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SetupPanel } from '../components/SetupPanel';
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

      {data.modules.length > 0 && (
        <SetupPanel
          nextLesson={data.nextUp.lesson}
          anyLessonDone={data.modules.some((m) => m.lessons.some((l) => l.status === 'done'))}
        />
      )}
      {data.modules.length > 0 && <NextUpPanel nextUp={data.nextUp} />}

      {data.modules.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
          No modules loaded yet. Add content under <code className="font-mono">curriculum/</code>{' '}
          and restart the API.
        </p>
      ) : (
        <>
          <OverallProgress modules={data.modules} />
          <ol className="mt-3 space-y-2" aria-label="Modules">
            {data.modules.map((m) => (
              <ModuleRow key={m.id} module={m} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/** Lessons and tasks done across the whole plan, as text and a bar. */
function OverallProgress({ modules }: { modules: ModuleSummary[] }) {
  const lessons = modules.flatMap((m) => m.lessons);
  const tasks = modules.flatMap((m) => m.tasks);
  const done = (items: { status: string }[]) => items.filter((i) => i.status === 'done').length;
  const total = lessons.length + tasks.length;
  const share = total === 0 ? 0 : (done(lessons) + done(tasks)) / total;
  return (
    <div className="mt-8">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {done(lessons)} of {lessons.length} lessons and {done(tasks)} of {tasks.length} tasks done
      </p>
      <div
        role="progressbar"
        aria-label="Overall progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div className="h-full bg-emerald-500" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
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
  const resume = nextUp.continueWith;
  const nothing =
    !resume &&
    !nextUp.lesson &&
    nextUp.tasks.length === 0 &&
    cards === 0 &&
    nextUp.reviewTasks.length === 0;

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
          {resume && (
            <li>
              Continue:{' '}
              {resume.kind === 'lesson' ? (
                <Link
                  to="/lessons/$moduleId/$lessonSlug"
                  params={{
                    moduleId: splitId(resume.id).moduleId,
                    lessonSlug: splitId(resume.id).slug,
                  }}
                  className="font-medium hover:underline"
                >
                  {resume.title}
                </Link>
              ) : (
                <Link
                  to="/tasks/$moduleId/$taskSlug"
                  params={{
                    moduleId: splitId(resume.id).moduleId,
                    taskSlug: splitId(resume.id).slug,
                  }}
                  className="font-medium hover:underline"
                >
                  {resume.title}
                </Link>
              )}{' '}
              <span className="text-zinc-500 dark:text-zinc-400">
                {resume.moduleTitle} · where you stopped last time
              </span>
            </li>
          )}
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

const statusText = {
  done: 'Done',
  in_progress: 'In progress',
  not_started: 'Not started',
} as const;

/** A status dot with its meaning as text for screen readers. */
function StatusDot({ status }: { status: keyof typeof statusDot }) {
  return (
    <>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${statusDot[status]}`} />
      <span className="sr-only">{statusText[status]}:</span>
    </>
  );
}

function moduleStatus(m: ModuleSummary): keyof typeof statusDot {
  const items = [...m.lessons, ...m.tasks];
  if (items.length > 0 && items.every((i) => i.status === 'done')) return 'done';
  return items.some((i) => i.status !== 'not_started') ? 'in_progress' : 'not_started';
}

/**
 * One module. Only a module in progress starts open; the rest are a single line
 * until opened, so the page is not twenty summaries long.
 */
function ModuleRow({ module: m }: { module: ModuleSummary }) {
  const lessonsDone = m.lessons.filter((l) => l.status === 'done').length;
  const tasksDone = m.tasks.filter((t) => t.status === 'done').length;
  const status = moduleStatus(m);
  return (
    <li
      className={`min-w-0 rounded-lg border break-words ${
        status === 'in_progress'
          ? 'border-zinc-400 dark:border-zinc-600'
          : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <details open={status === 'in_progress'} className="group">
        <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1 p-4">
          <h2 className="flex min-w-0 items-baseline gap-2 font-medium [overflow-wrap:anywhere]">
            <span
              aria-hidden="true"
              className="inline-block self-center text-xs text-zinc-400 transition-transform group-open:rotate-90"
            >
              ▶
            </span>
            <span className="flex items-center self-center">
              <StatusDot status={status} />
            </span>
            {m.title}
          </h2>
          <span className="flex flex-wrap gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{m.kind === 'core' ? 'Core' : 'Optional'}</span>
            <span>Effort {m.effort}</span>
            <span>
              {lessonsDone}/{m.lessons.length} lessons
            </span>
            <span>
              {tasksDone}/{m.tasks.length} tasks
            </span>
          </span>
        </summary>
        <div className="px-4 pb-4">
          {m.summary && <p className="text-sm text-zinc-600 dark:text-zinc-300">{m.summary}</p>}
          {m.services.length > 0 && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Practice services: {m.services.join(', ')}
            </p>
          )}
          <ol className="mt-3 space-y-1 text-sm">
            {m.lessons.map((l) => {
              const [moduleId = '', lessonSlug = ''] = l.id.split('/');
              return (
                <li key={l.id} className="flex items-center gap-2">
                  <StatusDot status={l.status} />
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
                  <StatusDot status={t.status} />
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
        </div>
      </details>
    </li>
  );
}
