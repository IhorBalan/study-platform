import type { Grade, QueueCard } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from '../components/Markdown';
import { Button, PageHeader, Select } from '../components/ui';
import { api } from '../lib/api';
import { lessonParams, reviewEstimate, untilLabel } from '../lib/format';
import { useStudySession } from '../lib/useStudySession';
import { moduleCardCounts } from '../lib/moduleCardCounts';
import { waitForNextDue } from '../lib/reviewWait';

/** "in 14 hours", "in 3 days": how long until a moment in the future. */
function untilDue(iso: string): string {
  const minutes = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
  if (minutes < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 48) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
}

export const Route = createFileRoute('/review')({
  // "?module=m07-queues" reviews the cards of one module only. It lives in the
  // address so a reload or Back keeps the choice.
  validateSearch: (search: Record<string, unknown>): { module?: string } =>
    typeof search.module === 'string' && search.module ? { module: search.module } : {},
  component: ReviewPage,
});

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

/**
 * Narrows the queue to one module. It offers only modules that have cards in the deck,
 * and is hidden while the deck is empty: every choice would lead to an empty queue.
 */
function ModuleFilter({
  moduleId,
  onChange,
}: {
  moduleId: string | undefined;
  onChange: (moduleId: string) => void;
}) {
  const plan = useQuery({ queryKey: ['plan'], queryFn: api.plan });
  const deck = useQuery({ queryKey: ['cards', 'active'], queryFn: () => api.cards('active') });
  const cardCounts = moduleCardCounts(deck.data?.cards ?? []);
  // The chosen module stays in the list even without cards, so the choice can be seen and undone.
  const modules = (plan.data?.modules ?? []).filter(
    (m) => cardCounts.has(m.id) || m.id === moduleId,
  );
  if (modules.length === 0) return null;
  return (
    <label className="mb-4 flex max-w-md items-center gap-2 text-sm">
      <span className="shrink-0 text-zinc-600 dark:text-zinc-300">Cards from</span>
      <Select value={moduleId ?? ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">All modules</option>
        {modules.map((m) => (
          <option key={m.id} value={m.id}>
            {m.title} ({cardCounts.get(m.id) ?? 0})
          </option>
        ))}
      </Select>
    </label>
  );
}

function ReviewPage() {
  const queryClient = useQueryClient();
  useStudySession('review', null);
  const { module: moduleId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queue = useQuery({
    queryKey: ['review-queue', moduleId ?? null],
    queryFn: () => api.reviewQueue(moduleId),
    // A card graded Again comes back within minutes. While the queue is empty and
    // the next card is that close, ask again when it is due, so it appears by
    // itself and the learner does not have to reload.
    refetchInterval: (query) => waitForNextDue(query.state.data),
  });
  // Read here so that each refetch renders again and "due in ..." stays current.
  void queue.dataUpdatedAt;
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
    onSuccess: (result, grade) => {
      if (card) setLastGraded({ id: card.id, reviewId: result.reviewId, grade });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      return queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
  });

  // The grade most recently given on this page, which can still be taken back.
  const [lastGraded, setLastGraded] = useState<{
    id: string;
    reviewId: string;
    grade: Grade;
  } | null>(null);
  const undo = useMutation({
    mutationFn: (last: { id: string; reviewId: string }) => api.undoReview(last.id, last.reviewId),
    onSuccess: () => {
      setLastGraded(null);
      setRevealedId(null);
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      return queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
  });

  const { mutate, isPending } = submit;
  const { mutate: undoMutate, isPending: undoPending } = undo;

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (isPending || event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.target instanceof HTMLElement &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
      )
        return;
      // By physical key, so it works in any keyboard layout.
      if (event.code === 'KeyZ' && lastGraded && !undoPending) {
        undoMutate(lastGraded);
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
    [cardId, isPending, revealed, mutate, lastGraded, undoPending, undoMutate],
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
        {counts.due} due · {counts.newAvailable} new
        {counts.due + counts.newAvailable > 0 &&
          ` · ${reviewEstimate(counts.due + counts.newAvailable, queue.data.secondsPerCard)}`}{' '}
        · {counts.reviewedToday} reviewed today ·{' '}
        <Link to="/cards" className="underline">
          Manage cards
        </Link>
        {counts.pendingApproval > 0 && <> ({counts.pendingApproval} waiting for approval)</>}
      </PageHeader>

      <ModuleFilter
        moduleId={moduleId}
        onChange={(next) => void navigate({ search: next ? { module: next } : {}, replace: true })}
      />

      {!card ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <p className="font-medium">
            {moduleId
              ? 'Nothing due in this module right now.'
              : counts.reviewedToday > 0
                ? `Done for now: ${counts.reviewedToday} ${counts.reviewedToday === 1 ? 'card' : 'cards'} reviewed today.`
                : 'Nothing due right now.'}
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {queue.data.nextDue
              ? `The next card is due ${untilDue(queue.data.nextDue)}.`
              : 'Finish a lesson to add its cards, or add your own under Manage cards.'}
          </p>
          {moduleId ? (
            <Link to="/review" className="mt-4 inline-block text-sm font-medium underline">
              Review cards from all modules
            </Link>
          ) : (
            <Link to="/" className="mt-4 inline-block text-sm font-medium underline">
              Back to the plan
            </Link>
          )}
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
            onClick={() => undo.mutate(lastGraded)}
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
