import type { ReviewDto, SubmissionDto } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { Button } from './ui';

const severityTone = {
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-zinc-500',
} as const;

/** Stage 2: build a prompt for Claude, take the reply back, and show the result. */
export function ReviewPanel({ submission }: { submission: SubmissionDto }) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['submissions', submission.taskId] });
  const review = submission.review;
  const checksBusy = submission.runs.some((r) => r.status === 'queued' || r.status === 'running');

  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const oneClick = settings.data?.reviewMode === 'bridge';
  const start = useMutation({
    mutationFn: (mode: 'copy_paste' | 'bridge') => api.startReview(submission.id, mode),
    onSuccess: refresh,
  });
  const failed = review?.status === 'error';

  const startButtons = (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {oneClick && (
        <Button disabled={checksBusy || start.isPending} onClick={() => start.mutate('bridge')}>
          {failed ? 'Try again' : 'Review with Claude'}
        </Button>
      )}
      <Button
        variant="secondary"
        disabled={checksBusy || start.isPending}
        onClick={() => start.mutate('copy_paste')}
      >
        {oneClick ? 'Use copy and paste instead' : 'Prepare review'}
      </Button>
      {!oneClick && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Builds a prompt you paste into Claude. Uses your own Claude plan.
        </span>
      )}
    </div>
  );

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h3 className="font-semibold">Claude review</h3>
      {!review && startButtons}
      {start.isError && (
        <p role="alert" className="mt-2 text-red-600">
          {start.error.message}
        </p>
      )}
      {review?.status === 'running' && (
        <p role="status" className="mt-2 text-sky-700 dark:text-sky-400">
          Claude is reviewing. This usually takes a minute or two.
        </p>
      )}
      {failed && (
        <>
          <p role="alert" className="mt-2 text-amber-700 dark:text-amber-400">
            {review.error ?? 'The review could not run.'}
          </p>
          {startButtons}
        </>
      )}
      {review?.status === 'queued' && (
        <PasteStep review={review} isRepo={submission.type === 'repo'} onDone={refresh} />
      )}
      {review?.status === 'passed' && review.result && (
        <ReviewResultView
          review={review}
          onAgain={() => start.mutate(oneClick ? 'bridge' : 'copy_paste')}
          busy={start.isPending}
        />
      )}
    </div>
  );
}

function PasteStep({
  review,
  isRepo,
  onDone,
}: {
  review: ReviewDto;
  isRepo: boolean;
  onDone: () => unknown;
}) {
  const [copied, setCopied] = useState(false);
  const [raw, setRaw] = useState('');
  const save = useMutation({
    mutationFn: () => api.submitReviewResult(review.runId, raw),
    onSuccess: onDone,
  });
  const copy = async () => {
    await navigator.clipboard.writeText(review.prompt);
    setCopied(true);
  };
  const errors = save.error instanceof ApiError ? save.error.errors : [];

  return (
    <ol className="mt-2 grid list-decimal gap-4 pl-5">
      <li>
        <p>
          {isRepo ? (
            <>
              Open a terminal in your lab repository, run <code className="font-mono">claude</code>,
              and paste the prompt. Claude reads the task folder itself.
            </>
          ) : (
            <>Paste the prompt into Claude (claude.ai or Claude Code).</>
          )}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Button variant="secondary" onClick={() => void copy()}>
            Copy prompt
          </Button>
          {copied && (
            <span role="status" className="text-xs text-emerald-600">
              Copied
            </span>
          )}
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-zinc-500">Show the prompt</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-zinc-50 p-2 text-xs whitespace-pre-wrap dark:bg-zinc-900">
            {review.prompt}
          </pre>
        </details>
      </li>
      <li>
        <label className="grid gap-1">
          <span>Paste Claude's reply here.</span>
          <textarea
            rows={6}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="rounded-md border border-zinc-300 bg-transparent p-2 font-mono text-xs dark:border-zinc-700"
          />
        </label>
        <div className="mt-2 flex items-center gap-3">
          <Button disabled={raw.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
            Save review
          </Button>
        </div>
        {save.isError && (
          <div role="alert" className="mt-2 text-red-600">
            <p>{save.error.message}</p>
            {errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </li>
    </ol>
  );
}

function ReviewResultView({
  review,
  onAgain,
  busy,
}: {
  review: ReviewDto;
  onAgain: () => void;
  busy: boolean;
}) {
  const result = review.result;
  if (!result) return null;
  return (
    <div className="mt-2 grid gap-4">
      <table className="w-full text-left">
        <caption className="sr-only">Rubric scores</caption>
        <tbody>
          {review.scores.map((s) => (
            <tr
              key={s.rubricId}
              className="border-b border-zinc-100 align-top dark:border-zinc-900"
            >
              <th scope="row" className="py-2 pr-3 font-medium whitespace-nowrap">
                {s.score} / {s.max}
              </th>
              <td className="py-2">
                {s.title}
                {s.comment && (
                  <span className="block text-zinc-600 dark:text-zinc-400">{s.comment}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.issues.length > 0 && (
        <section>
          <h4 className="font-medium">Issues</h4>
          <ul className="mt-1 grid gap-1">
            {result.issues.map((issue, i) => (
              <li key={i}>
                <span className={`font-medium ${severityTone[issue.severity]}`}>
                  {issue.severity}
                </span>{' '}
                {issue.file && (
                  <code className="font-mono text-xs">
                    {issue.file}
                    {issue.line ? `:${issue.line}` : ''}
                  </code>
                )}{' '}
                {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {result.securityConcerns.length > 0 && (
        <section>
          <h4 className="font-medium">Security</h4>
          <ul className="mt-1 list-disc pl-5">
            {result.securityConcerns.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}
      {result.strengths.length > 0 && (
        <section>
          <h4 className="font-medium">Done well</h4>
          <ul className="mt-1 list-disc pl-5">
            {result.strengths.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}
      <p>
        <span className="font-medium">Next step:</span> {result.nextStep}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {review.cardsSuggested > 0 && (
          <Link to="/cards" className="underline">
            {review.cardsSuggested === 1
              ? '1 suggested card is waiting for your approval'
              : `${review.cardsSuggested} suggested cards are waiting for your approval`}
          </Link>
        )}
        <Button variant="secondary" disabled={busy} onClick={onAgain}>
          Review again
        </Button>
      </div>
    </div>
  );
}
