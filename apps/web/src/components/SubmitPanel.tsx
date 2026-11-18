import type { RunDto, SubmissionDto, TaskDetail } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { ReviewPanel } from './ReviewPanel';
import { Button, Input } from './ui';

const runLabel: Record<RunDto['status'], string> = {
  queued: 'Waiting to run',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  error: 'Could not run',
  not_run: 'Skipped',
};

const runTone: Record<RunDto['status'], string> = {
  queued: 'text-zinc-500',
  running: 'text-sky-600 dark:text-sky-400',
  passed: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400',
  error: 'text-amber-600 dark:text-amber-400',
  not_run: 'text-amber-600 dark:text-amber-400',
};

const isActive = (s: SubmissionDto) =>
  s.runs.some((r) => r.status === 'queued' || r.status === 'running') ||
  s.review?.status === 'running';

/** Submitting a task and reading the result of its automated checks. */
export function SubmitPanel({ task }: { task: TaskDetail }) {
  const queryClient = useQueryClient();
  const key = ['submissions', task.id];
  const submissions = useQuery({
    queryKey: key,
    queryFn: () => api.submissions(task.id),
    // Poll only while a check is in flight.
    refetchInterval: (query) => (query.state.data?.submissions.some(isActive) ? 1500 : false),
  });
  const bridge = useQuery({
    queryKey: ['bridge'],
    queryFn: api.bridge,
    enabled: task.type === 'repo' && task.hasChecks,
    refetchInterval: 30_000,
  });

  const [commitSha, setCommitSha] = useState('');
  const [answer, setAnswer] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      task.type === 'repo'
        ? api.submit(task.id, {
            type: 'repo',
            ...(commitSha.trim() ? { commitSha: commitSha.trim() } : {}),
          })
        : api.submit(task.id, { type: 'text', body: answer }),
    onSuccess: () => {
      setCommitSha('');
      return queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit.mutate();
  };

  return (
    <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">Submit</h2>

      {task.type === 'diagram' ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Diagram uploads arrive together with Claude review.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-3 grid gap-3">
          {task.type === 'repo' ? (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Commit your work in the lab repository, then submit. The checks run against the
                commit, so uncommitted changes are not seen.
              </p>
              {bridge.data && !bridge.data.reachable && (
                <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
                  The host bridge is not running, so automated checks will be skipped. Start
                  everything with <code className="font-mono">pnpm dev</code>.
                </p>
              )}
              {bridge.data?.reachable && !bridge.data.docker && (
                <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
                  Docker is not running, so automated checks cannot start.
                </p>
              )}
              <label className="grid gap-1 text-sm sm:max-w-sm">
                <span className="font-medium">Commit</span>
                <Input
                  type="text"
                  value={commitSha}
                  onChange={(e) => setCommitSha(e.target.value)}
                  placeholder="Latest commit"
                  pattern="[0-9a-fA-F]{7,40}"
                  title="A commit id of 7 to 40 hex characters, or empty for the latest commit"
                  className="font-mono"
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Leave empty to check the latest commit.
                </span>
              </label>
            </>
          ) : (
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Your answer</span>
              <textarea
                required
                rows={12}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Markdown is supported."
                className="rounded-md border border-zinc-300 bg-transparent p-3 font-mono text-sm dark:border-zinc-700"
              />
            </label>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submit.isPending}>
              {task.type === 'repo' ? 'Run checks' : 'Save answer'}
            </Button>
            {submit.isError && (
              <span role="alert" className="text-sm text-red-600">
                {submit.error.message}
              </span>
            )}
          </div>
        </form>
      )}

      {submissions.data && submissions.data.submissions.length > 0 && (
        <ol className="mt-8 grid gap-4" aria-label="Submissions">
          {submissions.data.submissions.map((s, index) => (
            <SubmissionCard key={s.id} submission={s} open={index === 0} />
          ))}
        </ol>
      )}
    </section>
  );
}

function SubmissionCard({ submission, open }: { submission: SubmissionDto; open: boolean }) {
  const run = submission.runs.find((r) => r.stage === 'checks');
  const passed = run?.checks.filter((c) => c.passed).length ?? 0;

  return (
    <li className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <details open={open}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium">{new Date(submission.createdAt).toLocaleString()}</span>
          {submission.commitSha && (
            <code className="font-mono text-xs text-zinc-500">
              {submission.commitSha.slice(0, 10)}
            </code>
          )}
          {run ? (
            <span className={`font-medium ${runTone[run.status]}`} role="status">
              {runLabel[run.status]}
              {run.checks.length > 0 && ` · ${passed} of ${run.checks.length} checks`}
            </span>
          ) : (
            <span className="text-zinc-500">
              {submission.review?.status === 'passed'
                ? 'Saved'
                : 'Saved · counts as done after a Claude review'}
            </span>
          )}
          {submission.review?.status === 'passed' && (
            <span className="font-medium text-violet-600 dark:text-violet-400">
              Reviewed · {submission.review.scores.reduce((sum, x) => sum + x.score, 0)} of{' '}
              {submission.review.scores.reduce((sum, x) => sum + x.max, 0)} points
            </span>
          )}
        </summary>

        {run?.error && (
          <p className="mt-3 text-zinc-700 dark:text-zinc-300">
            {run.error}{' '}
            {run.error.includes('Settings') && (
              <Link to="/settings" className="underline">
                Open settings
              </Link>
            )}
          </p>
        )}

        {run && run.checks.length > 0 && (
          <ul className="mt-3 grid gap-2">
            {run.checks.map((check) => (
              <li key={check.criterionId}>
                <span
                  className={
                    check.passed
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                >
                  <span aria-hidden="true">{check.passed ? '✓' : '✗'}</span>{' '}
                  <span className="sr-only">{check.passed ? 'Passed:' : 'Failed:'}</span>
                </span>
                {check.title}
                {check.log && (
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-zinc-50 p-2 text-xs whitespace-pre-wrap dark:bg-zinc-900">
                    {check.log}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}

        <ReviewPanel submission={submission} />

        {submission.body && (
          <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-zinc-50 p-3 text-xs whitespace-pre-wrap dark:bg-zinc-900">
            {submission.body}
          </pre>
        )}
      </details>
    </li>
  );
}
