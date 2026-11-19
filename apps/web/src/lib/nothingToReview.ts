/**
 * True when a check run ended because the submitted code could not be found:
 * no lab repository, no such commit, or no task folder in the commit. A Claude
 * review would then be asked to read code that is not there.
 *
 * Other failures to run (the checker restarted, Docker is not running) leave
 * the code where it is, so a review still makes sense.
 */
export function nothingToReview(run: { status: string; error: string | null } | undefined) {
  if (!run || run.status !== 'error' || !run.error) return false;
  return [
    'was not found', // the repository or the commit
    'does not exist in commit', // the task folder
    'has no commits yet',
    'Set the path of your lab repository',
    'must be absolute',
  ].some((part) => run.error?.includes(part));
}
