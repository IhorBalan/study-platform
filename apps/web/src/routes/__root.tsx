import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Button } from '../components/ui';
import { HealthBadge } from '../components/HealthBadge';
import { Shortcuts } from '../components/Shortcuts';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const nav = [
  { to: '/', label: 'Plan' },
  { to: '/review', label: 'Review' },
  { to: '/search', label: 'Search' },
  { to: '/notes', label: 'Notes' },
  { to: '/stats', label: 'Stats' },
  { to: '/settings', label: 'Settings' },
] as const;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function NotFound() {
  useDocumentTitle('Page not found');
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
      {/* The first Tab stop on every page, shown only while it has focus. */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white dark:focus:bg-zinc-100 dark:focus:text-zinc-900"
      >
        Skip to content
      </a>
      {/* On a phone the title and status share the first line and the links take the second.
          Six links fit a 360px screen only with tight padding; narrower screens scroll the row. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 py-3 sm:py-4 dark:border-zinc-800">
        <span className="font-semibold">Study platform</span>
        <nav
          className="order-last -mx-1 flex w-full min-w-0 items-center justify-between overflow-x-auto sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:justify-start sm:gap-1"
          aria-label="Main"
        >
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="shrink-0 rounded-md px-1.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 sm:px-3 dark:text-zinc-300 dark:hover:bg-zinc-900"
              activeProps={{
                className: 'bg-zinc-100 font-medium text-zinc-950 dark:bg-zinc-900 dark:text-white',
              }}
              activeOptions={{ exact: item.to === '/', includeSearch: false }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <HealthBadge />
        </div>
      </header>
      <main id="content" tabIndex={-1} className="flex-1 py-8 outline-none">
        <Outlet />
      </main>
      <footer className="hidden pb-4 text-xs text-zinc-500 sm:block dark:text-zinc-400">
        Press <kbd className="font-mono">?</kbd> for keyboard shortcuts
      </footer>
      <Shortcuts />
    </div>
  );
}
