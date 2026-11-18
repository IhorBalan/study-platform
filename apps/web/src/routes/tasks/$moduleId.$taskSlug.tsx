import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Command } from '../../components/CopyButton';
import { Markdown } from '../../components/Markdown';
import { NotesBox } from '../../components/NotesBox';
import { SubmitPanel } from '../../components/SubmitPanel';
import { api } from '../../lib/api';
import { editorLink, taskFolder } from '../../lib/editorLink';
import { useScrollMemory } from '../../lib/useScrollMemory';
import { useStudySession } from '../../lib/useStudySession';

const taskQuery = (id: string) =>
  queryOptions({ queryKey: ['task', id], queryFn: () => api.task(id) });

export const Route = createFileRoute('/tasks/$moduleId/$taskSlug')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(taskQuery(`${params.moduleId}/${params.taskSlug}`)),
  component: TaskPage,
});

const typeLabel = { repo: 'Code task', text: 'Written answer', diagram: 'Diagram' } as const;

const statusLabel = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
} as const;
const statusTone = {
  not_started: 'text-zinc-500 dark:text-zinc-400',
  in_progress: 'text-amber-700 dark:text-amber-400',
  done: 'text-emerald-700 dark:text-emerald-400',
} as const;

const splitId = (id: string) => {
  const [moduleId = '', taskSlug = ''] = id.split('/');
  return { moduleId, taskSlug };
};

function TaskPage() {
  const { moduleId, taskSlug } = Route.useParams();
  const { data: task } = useSuspenseQuery(taskQuery(`${moduleId}/${taskSlug}`));
  useStudySession('task', task.id);
  useScrollMemory(task.id);

  // The folder on this computer, once the lab repository path is known.
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    enabled: task.type === 'repo',
  });
  const labRepoPath = settings.data?.labRepoPath;
  const folder = labRepoPath ? taskFolder(labRepoPath, task.labFolder) : null;
  const link = folder && settings.data ? editorLink(settings.data.editor, folder) : null;

  // The plan knows this task's status and its neighbours in the module.
  const queryClient = useQueryClient();
  const plan = useQuery({ queryKey: ['plan'], queryFn: api.plan });
  const siblings = plan.data?.modules.find((m) => m.id === task.moduleId)?.tasks ?? [];
  const index = siblings.findIndex((t) => t.id === task.id);
  const current = siblings[index];
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 ? siblings[index + 1] : undefined;

  // A finished check run or review can change the status, so ask for the plan again
  // whenever the list of submissions is refreshed and no run is in flight.
  const submissions = useQuery({
    queryKey: ['submissions', task.id],
    queryFn: () => api.submissions(task.id),
  });
  const busy = submissions.data?.submissions.some(
    (s) =>
      s.runs.some((r) => r.status === 'queued' || r.status === 'running') ||
      s.review?.status === 'running',
  );
  const settledAt = submissions.isFetching || busy ? 0 : submissions.dataUpdatedAt;
  useEffect(() => {
    if (settledAt > 0) void queryClient.invalidateQueries({ queryKey: ['plan'] });
  }, [settledAt, queryClient]);

  return (
    <article>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link to="/" className="hover:underline">
          Plan
        </Link>{' '}
        / {task.moduleTitle} / {typeLabel[task.type]}
      </p>
      <h1 className="mt-1 text-3xl font-semibold">{task.title}</h1>
      <p className={`mt-1 mb-6 text-sm font-medium ${current ? statusTone[current.status] : ''}`}>
        {current ? statusLabel[current.status] : '\u00a0'}
        {current?.status === 'done' && next && (
          <>
            {' · '}
            <Link to="/tasks/$moduleId/$taskSlug" params={splitId(next.id)} className="underline">
              Next: {next.title}
            </Link>
          </>
        )}
      </p>

      <Markdown>{task.markdown}</Markdown>

      {task.type === 'repo' && (
        <p className="mt-6 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          Run <Command>{`pnpm lab start ${task.id}`}</Command> to copy the starter files, then work
          in <code className="font-mono">{task.labFolder}</code> inside your lab repository.
          {task.services.length > 0 && <> Needs: {task.services.join(', ')}.</>}
          {folder && (
            <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Command>{folder}</Command>
              {link && (
                <a href={link.href} className="font-medium underline">
                  {link.label}
                </a>
              )}
            </span>
          )}
        </p>
      )}

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        {task.criteria.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold">Automated checks</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
              {task.criteria.map((c) => (
                <li key={c.id}>{c.title}</li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2 className="text-sm font-semibold">Review rubric</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            {task.rubric.map((r) => (
              <li key={r.id}>
                {r.title} <span className="text-zinc-500 dark:text-zinc-400">(0–{r.max})</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {task.hints.length > 0 && (
        <details className="mt-8 text-sm">
          <summary className="cursor-pointer font-semibold">Hints</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
            {task.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </details>
      )}

      <SubmitPanel task={task} />
      <NotesBox key={task.id} itemId={task.id} />

      {(previous || next) && (
        <nav
          className="mt-10 flex justify-between gap-4 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800"
          aria-label="Tasks in this module"
        >
          {previous ? (
            <Link
              to="/tasks/$moduleId/$taskSlug"
              params={splitId(previous.id)}
              className="hover:underline"
            >
              ← {previous.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              to="/tasks/$moduleId/$taskSlug"
              params={splitId(next.id)}
              className="text-right hover:underline"
            >
              {next.title} →
            </Link>
          )}
        </nav>
      )}
    </article>
  );
}
