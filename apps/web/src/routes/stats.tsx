import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/stats')({ component: StatsPage });

function StatsPage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Stats</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Not built yet.</p>
    </section>
  );
}
