import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { HealthBadge } from '../components/HealthBadge';

const nav = [
  { to: '/', label: 'Plan' },
  { to: '/review', label: 'Review' },
  { to: '/stats', label: 'Stats' },
  { to: '/settings', label: 'Settings' },
] as const;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 py-4 dark:border-zinc-800">
        <nav className="flex items-center gap-1" aria-label="Main">
          <span className="mr-3 font-semibold">Study platform</span>
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              activeProps={{
                className: 'bg-zinc-100 font-medium text-zinc-950 dark:bg-zinc-900 dark:text-white',
              }}
              activeOptions={{ exact: item.to === '/' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <HealthBadge />
      </header>
      <main className="flex-1 py-8">
        <Outlet />
      </main>
    </div>
  );
}
