import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Button } from '../components/ui';
import { HealthBadge } from '../components/HealthBadge';

const nav = [
  { to: '/', label: 'Plan' },
  { to: '/review', label: 'Review' },
  { to: '/stats', label: 'Stats' },
  { to: '/settings', label: 'Settings' },
] as const;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <section className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        There is nothing at this address.
      </p>
      <Link to="/" className="mt-6 inline-block">
        <Button>Back to the plan</Button>
      </Link>
    </section>
  );
}

function RootLayout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-zinc-200 py-4 dark:border-zinc-800">
        <nav className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Main">
          <span className="mr-3 font-semibold">Study platform</span>
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              activeProps={{
                className: 'bg-zinc-100 font-medium text-zinc-950 dark:bg-zinc-900 dark:text-white',
              }}
              activeOptions={{ exact: item.to === '/', includeSearch: false }}
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
