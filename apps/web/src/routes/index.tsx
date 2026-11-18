import type { ModuleSummary } from '@study/shared';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
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

      {data.modules.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
          No modules loaded yet. Add content under <code className="font-mono">curriculum/</code>{' '}
          and restart the API.
        </p>
      ) : (
        <ol className="mt-6 space-y-3">
          {data.modules.map((m) => (
            <ModuleRow key={m.id} module={m} />
          ))}
        </ol>
      )}
    </section>
  );
}

function ModuleRow({ module: m }: { module: ModuleSummary }) {
  const done = m.lessons.filter((l) => l.status === 'done').length;
  return (
    <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{m.title}</h2>
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
    </li>
  );
}
