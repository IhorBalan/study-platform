import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

function SettingsPage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Not built yet.</p>
    </section>
  );
}
