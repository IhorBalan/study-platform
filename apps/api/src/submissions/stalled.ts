/** How long a run may wait before the page says that nothing is picking it up. */
export const STALLED_AFTER_MS = 20_000;

/**
 * True when a check run has waited a while although no other run is in
 * progress. The checker takes a waiting run within a few seconds when it is
 * free, so this means the checker (the worker process) is not running.
 *
 * A run that waits behind another one is not stalled: checks run one at a time.
 */
export function isStalled(
  run: { status: string; createdAt: Date },
  anotherRunInProgress: boolean,
  now: Date,
): boolean {
  return (
    run.status === 'queued' &&
    !anotherRunInProgress &&
    now.getTime() - run.createdAt.getTime() > STALLED_AFTER_MS
  );
}
