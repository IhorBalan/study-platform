import { Link, type ErrorComponentProps } from '@tanstack/react-router';
import { ApiError } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { Button } from './ui';

/** Shown in place of a page that failed to load, inside the normal layout. */
export function RouteError({ error }: ErrorComponentProps) {
  const missing = error instanceof ApiError && error.status === 404;
  useDocumentTitle(missing ? 'Page not found' : 'Could not load');
  return (
    <section className="py-16 text-center">
      <h1 className="text-2xl font-semibold">
        {missing ? 'Page not found' : 'This page could not be loaded'}
      </h1>
      <p role="alert" className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {missing
          ? 'There is no lesson or task at this address.'
          : error instanceof Error
            ? error.message
            : 'Unknown error'}
      </p>
      <Link to="/" className="mt-6 inline-block">
        <Button>Back to the plan</Button>
      </Link>
    </section>
  );
}
