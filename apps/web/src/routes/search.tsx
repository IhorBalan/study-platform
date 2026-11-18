import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Input, PageHeader } from '../components/ui';
import { api } from '../lib/api';

const MIN_LENGTH = 2;

export const Route = createFileRoute('/search')({
  // The search text lives in the address, so a search can be bookmarked and survives a reload.
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : '',
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [text, setText] = useState(q);

  // The address can change without typing: the Search link clears it, and Back and Forward
  // move between searches. Follow it, or the old text would be searched again.
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    if (q !== text.trim()) setText(q);
  }

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === q) return;
    const timer = setTimeout(() => {
      void navigate({ search: { q: trimmed }, replace: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [text, q, navigate]);

  const enabled = q.length >= MIN_LENGTH;
  const search = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled,
    placeholderData: keepPreviousData,
  });
  const results = enabled ? (search.data?.results ?? []) : [];

  return (
    <section>
      <PageHeader title="Search">
        Find a lesson or a task by a word in its title or text.
      </PageHeader>
      <Input
        type="search"
        autoFocus
        aria-label="Search lessons and tasks"
        placeholder="For example: idempotency, EXPLAIN, refresh token"
        maxLength={100}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />

      <div className="mt-6" aria-live="polite">
        {search.isError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Search failed: {search.error.message}
          </p>
        )}
        {enabled && search.isSuccess && results.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Nothing matches “{q}”. Every word has to appear on the page, so try fewer words.
          </p>
        )}
        {results.length > 0 && (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {results.map((result) => {
              const [moduleId = '', slug = ''] = result.id.split('/');
              return (
                <li key={`${result.kind}:${result.id}`} className="py-3">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {result.kind === 'lesson' ? 'Lesson' : 'Task'} · {result.moduleTitle}
                  </p>
                  {result.kind === 'lesson' ? (
                    <Link
                      to="/lessons/$moduleId/$lessonSlug"
                      params={{ moduleId, lessonSlug: slug }}
                      className="font-medium hover:underline"
                    >
                      {result.title}
                    </Link>
                  ) : (
                    <Link
                      to="/tasks/$moduleId/$taskSlug"
                      params={{ moduleId, taskSlug: slug }}
                      className="font-medium hover:underline"
                    >
                      {result.title}
                    </Link>
                  )}
                  {result.snippet && (
                    <p className="mt-1 text-sm break-words text-zinc-600 dark:text-zinc-300">
                      {result.snippet}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
