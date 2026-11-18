import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { api } from '../../lib/api';
import { lessonOutline, readingMinutes } from '../../lib/lessonOutline';
import { useStudySession } from '../../lib/useStudySession';

const lessonQuery = (id: string) =>
  queryOptions({ queryKey: ['lesson', id], queryFn: () => api.lesson(id) });

export const Route = createFileRoute('/lessons/$moduleId/$lessonSlug')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(lessonQuery(`${params.moduleId}/${params.lessonSlug}`)),
  component: LessonPage,
});

function splitId(id: string) {
  const [moduleId = '', lessonSlug = ''] = id.split('/');
  return { moduleId, lessonSlug };
}

function LessonPage() {
  const { moduleId, lessonSlug } = Route.useParams();
  const id = `${moduleId}/${lessonSlug}`;
  const { data: lesson } = useSuspenseQuery(lessonQuery(id));
  const queryClient = useQueryClient();
  const outline = useMemo(() => lessonOutline(lesson.markdown), [lesson.markdown]);
  useStudySession('lesson', id);
  const [notice, setNotice] = useState<{ lessonId: string; text: string } | null>(null);

  const progress = useMutation({
    mutationFn: (status: 'in_progress' | 'done') => api.setLessonProgress(id, status),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['lesson', id] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      if (result.cardsAdded > 0) {
        setNotice({
          lessonId: id,
          text: `${result.cardsAdded} cards from this lesson joined your review queue.`,
        });
      }
    },
  });

  // Opening a lesson for the first time marks it as started.
  const { mutate, isIdle } = progress;
  useEffect(() => {
    if (lesson.status === 'not_started' && isIdle) mutate('in_progress');
  }, [lesson.status, isIdle, mutate]);

  return (
    <article>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link to="/" className="hover:underline">
          Plan
        </Link>{' '}
        / {lesson.moduleTitle}
      </p>
      <h1 className="mt-1 text-3xl font-semibold">{lesson.title}</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        About {readingMinutes(lesson.markdown)} min read
      </p>

      {outline.length > 1 && (
        <details className="mb-6 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">
            In this lesson ({outline.length} sections)
          </summary>
          <nav aria-label="Sections of this lesson">
            <ol className="mt-2 space-y-1">
              {outline.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="hover:underline">
                    {item.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </details>
      )}

      <Markdown sectionIds={outline.map((item) => item.id)}>{lesson.markdown}</Markdown>

      <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        {lesson.status === 'done' ? (
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Completed
          </span>
        ) : (
          <button
            type="button"
            disabled={progress.isPending}
            onClick={() => progress.mutate('done')}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Mark as done
          </button>
        )}
        {lesson.status !== 'done' && lesson.cardCount > 0 && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Adds {lesson.cardCount} cards to your review queue
          </span>
        )}
        {notice?.lessonId === id && (
          <span role="status" className="text-sm text-zinc-600 dark:text-zinc-300">
            {notice.text}
          </span>
        )}
        {lesson.status === 'done' && (
          <span className="flex flex-wrap items-center gap-3 sm:ml-auto">
            {notice?.lessonId === id && (
              <Link
                to="/review"
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Review the new cards
              </Link>
            )}
            {lesson.next ? (
              <Link
                to="/lessons/$moduleId/$lessonSlug"
                params={splitId(lesson.next.id)}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Next: {lesson.next.title}
              </Link>
            ) : (
              <Link
                to="/"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Back to the plan
              </Link>
            )}
          </span>
        )}
        {progress.isError && (
          <span role="alert" className="text-sm text-red-600 dark:text-red-400">
            Could not save progress: {progress.error.message}
          </span>
        )}
      </div>

      <nav className="mt-6 flex justify-between gap-4 text-sm" aria-label="Lessons">
        {lesson.previous ? (
          <Link
            to="/lessons/$moduleId/$lessonSlug"
            params={splitId(lesson.previous.id)}
            className="text-zinc-600 hover:underline dark:text-zinc-300"
          >
            ← {lesson.previous.title}
          </Link>
        ) : (
          <span />
        )}
        {lesson.next && (
          <Link
            to="/lessons/$moduleId/$lessonSlug"
            params={splitId(lesson.next.id)}
            className="text-right text-zinc-600 hover:underline dark:text-zinc-300"
          >
            {lesson.next.title} →
          </Link>
        )}
      </nav>
    </article>
  );
}
