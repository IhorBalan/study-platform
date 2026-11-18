import type { Grade, QueueCard } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from '../components/Markdown';
import { Button, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { lessonParams, untilLabel } from '../lib/format';
import { useStudySession } from '../lib/useStudySession';

/** "in 14 hours", "in 3 days": how long until a moment in the future. */
function untilDue(iso: string): string {
  const minutes = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
  if (minutes < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 48) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
}

export const Route = createFileRoute('/review')({ component: ReviewPage });

const grades: { grade: Grade; label: string; key: string; tone: string }[] = [
  { grade: 'again', label: 'Again', key: '1', tone: 'border-red-300 dark:border-red-900' },
  { grade: 'hard', label: 'Hard', key: '2', tone: 'border-amber-300 dark:border-amber-900' },
  { grade: 'good', label: 'Good', key: '3', tone: 'border-emerald-300 dark:border-emerald-900' },
  { grade: 'easy', label: 'Easy', key: '4', tone: 'border-sky-300 dark:border-sky-900' },
];

/** Cloze fronts hide a span as {{...}}; show a blank until the answer is revealed. */
function renderFront(card: QueueCard): string {
  return card.type === 'cloze' ? card.front.replaceAll(/\{\{.*?\}\}/g, '`[ … ]`') : card.front;
}

function ReviewPage() {
  const queryClient = useQueryClient();
  useStudySession('review', null);
  const queue = useQuery({ queryKey: ['review-queue'], queryFn: api.reviewQueue });
  // Remember which card was revealed, so the next card starts hidden without a reset.
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const shownAt = useRef(0);

  const card = queue.data?.cards[0];
  const cardId = card?.id;
  const revealed = cardId !== undefined && revealedId === cardId;

  useEffect(() => {
    if (cardId) shownAt.current = Date.now();
  }, [cardId]);

  const submit = useMutation({
    mutationFn: (grade: Grade) => {
      if (!cardId) throw new Error('no card');
      return api.submitReview(cardId, grade, Date.now() - shownAt.current);
    },
    onSuccess: (_result, grade) => {
      if (card) setLastGraded({ id: card.id, grade });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      return queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
  });

  // The grade most recently given on this page, which can still be taken back.
  const [lastGraded, setLastGraded] = useState<{ id: string; grade: Grade } | null>(null);
  const undo = useMutation({
    mutationFn: (id: string) => api.undoReview(id),
    onSuccess: () => {
      setLastGraded(null);
      setRevealedId(null);
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      return queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
  });

  const { mutate, isPending } = submit;
  const { mutate: undoMutate, isPending: undoPending } = undo;
  const lastGradedId = lastGraded?.id;
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (isPending || event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.target instanceof HTMLElement &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
      )
        return;
      // By physical key, so it works in any keyboard layout.
      if (event.code === 'KeyZ' && lastGradedId && !undoPending) {
        undoMutate(lastGradedId);
        return;
      }
      if (!cardId) return;
      if (!revealed && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        setRevealedId(cardId);
        return;
      }
      const match = revealed && grades.find((g) => g.key === event.key);
      if (match) mutate(match.grade);
    },
    [cardId, isPending, revealed, mutate, lastGradedId, undoPending, undoMutate],
  );
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  if (queue.isPending) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  if (queue.isError) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        Could not load the review queue: {queue.error.message}
      </p>
    );
  }

  const { counts } = queue.data;

  return (
    <section>
      <PageHeader title="Review">
        {counts.due} due · {counts.newAvailable} new · {counts.reviewedToday} reviewed today ·{' '}
        <Link to="/cards" className="underline">
          Manage cards
        </Link>
        {counts.pendingApproval > 0 && <> ({counts.pendingApproval} waiting for approval)</>}
      </PageHeader>

      {!card ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <p className="font-medium">
            {counts.reviewedToday > 0
              ? `Done for now: ${counts.reviewedToday} ${counts.reviewedToday === 1 ? 'card' : 'cards'} reviewed today.`
              : 'Nothing due right now.'}
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {queue.data.nextDue
              ? `The next card is due ${untilDue(queue.data.nextDue)}.`
              : 'Finish a lesson to add its cards, or add your own under Manage cards.'}
          </p>
          <Link to="/" className="mt-4 inline-block text-sm font-medium underline">
            Back to the plan
          </Link>
        </div>
      ) : (
        <div className="mx-auto max-w-2xl">
          <div className="min-h-64 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
            <p className="mb-3 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {card.type}
              {card.state === 'new' && ' · new'}
            </p>
            <Markdown>{renderFront(card)}</Markdown>
            {revealed && (
              <div className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-800">
                <Markdown>{card.back}</Markdown>
                {card.lessonId && (
                  <p className="mt-4 text-sm">
                    <Link
                      to="/lessons/$moduleId/$lessonSlug"
                      params={lessonParams(card.lessonId)}
                      className="text-zinc-600 underline dark:text-zinc-300"
                    >
                      Open the lesson this card comes from
                    </Link>
                  </p>
                )}
              </div>
            )}
          </div>

          {revealed ? (
            <div className="mt-4 grid grid-cols-4 gap-2">
              {grades.map((g) => (
                <button
                  key={g.grade}
                  type="button"
                  disabled={submit.isPending}
                  onClick={() => submit.mutate(g.grade)}
                  className={`rounded-md border-2 px-2 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900 ${g.tone}`}
                >
                  <span className="block font-medium">{g.label}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {untilLabel(card.preview[g.grade] ?? card.due)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Button className="mt-4 w-full" onClick={() => setRevealedId(card.id)}>
              Show answer
            </Button>
          )}
          {/* Key hints mean nothing on a touch screen. */}
          <p className="mt-3 text-center text-xs text-zinc-500 pointer-coarse:hidden dark:text-zinc-400">
            Space shows the answer. Keys 1–4 grade it.
          </p>
          {submit.isError && (
            <p role="alert" className="mt-2 text-center text-sm text-red-600 dark:text-red-400">
              Could not save the review: {submit.error.message}
            </p>
          )}
        </div>
      )}

      {lastGraded && (
        <p className="mt-4 text-center text-sm text-zinc-600 dark:text-zinc-300">
          Last card graded {grades.find((g) => g.grade === lastGraded.grade)?.label}.{' '}
          <button
            type="button"
            className="font-medium underline disabled:opacity-50"
            disabled={undo.isPending}
            onClick={() => undo.mutate(lastGraded.id)}
          >
            Undo
          </button>{' '}
          <span className="text-xs text-zinc-500 pointer-coarse:hidden dark:text-zinc-400">
            (key Z)
          </span>
        </p>
      )}
      {undo.isError && (
        <p role="alert" className="mt-2 text-center text-sm text-red-600 dark:text-red-400">
          Could not undo: {undo.error.message}
        </p>
      )}
    </section>
  );
}
