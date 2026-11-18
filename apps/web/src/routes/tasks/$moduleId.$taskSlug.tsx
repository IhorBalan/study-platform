import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Markdown } from '../../components/Markdown';
import { SubmitPanel } from '../../components/SubmitPanel';
import { api } from '../../lib/api';

const taskQuery = (id: string) =>
  queryOptions({ queryKey: ['task', id], queryFn: () => api.task(id) });

export const Route = createFileRoute('/tasks/$moduleId/$taskSlug')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(taskQuery(`${params.moduleId}/${params.taskSlug}`)),
  component: TaskPage,
});

const typeLabel = { repo: 'Code task', text: 'Written answer', diagram: 'Diagram' } as const;

function TaskPage() {
  const { moduleId, taskSlug } = Route.useParams();
  const { data: task } = useSuspenseQuery(taskQuery(`${moduleId}/${taskSlug}`));

  return (
    <article>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link to="/" className="hover:underline">
          Plan
        </Link>{' '}
        / {task.moduleTitle} / {typeLabel[task.type]}
      </p>
      <h1 className="mt-1 mb-6 text-3xl font-semibold">{task.title}</h1>

      <Markdown>{task.markdown}</Markdown>

      {task.type === 'repo' && (
        <p className="mt-6 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          Run <code className="font-mono">pnpm lab start {task.id}</code> to copy the starter files,
          then work in <code className="font-mono">{task.labFolder}</code> inside your lab
          repository.
          {task.services.length > 0 && <> Needs: {task.services.join(', ')}.</>}
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
                {r.title} <span className="text-zinc-400">(0–{r.max})</span>
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
    </article>
  );
}
