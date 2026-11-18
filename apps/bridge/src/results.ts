import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Most a check run may write to its results folder. A real results file is a
 * few kilobytes: one short JSON line per criterion.
 */
export const MAX_RESULTS_BYTES = 1024 * 1024;

export interface ReportedResult {
  id: string;
  name: string;
  passed: boolean;
  message: string | null;
}

/** Total size of the files directly inside a folder. Missing files count as empty. */
export async function folderBytes(dir: string): Promise<number> {
  const names = await readdir(dir).catch(() => [] as string[]);
  let total = 0;
  for (const name of names) {
    total += await stat(path.join(dir, name)).then(
      (s) => s.size,
      () => 0,
    );
  }
  return total;
}

/**
 * Calls `onExceeded` once if the folder grows past the limit while a run is in progress.
 *
 * The results folder is the one place the sandbox can write on the host, and
 * the submission's own code runs in that sandbox. Without this, it could fill
 * the disk for as long as the run's time limit allows.
 */
export function watchFolderSize(
  dir: string,
  onExceeded: () => void,
  limit = MAX_RESULTS_BYTES,
  intervalMs = 1000,
): { exceeded: () => boolean; stop: () => void } {
  let exceeded = false;
  const timer = setInterval(() => {
    void folderBytes(dir).then((bytes) => {
      if (exceeded || bytes <= limit) return;
      exceeded = true;
      clearInterval(timer);
      onExceeded();
    });
  }, intervalMs);
  timer.unref();
  return { exceeded: () => exceeded, stop: () => clearInterval(timer) };
}

/**
 * Reads the results the check suite reported. Returns `null` when the file is
 * larger than any real results file, so it is never loaded into memory.
 */
export async function readResults(
  file: string,
  limit = MAX_RESULTS_BYTES,
): Promise<ReportedResult[] | null> {
  const size = await stat(file).then(
    (s) => s.size,
    () => 0,
  );
  if (size > limit) return null;
  const text = await readFile(file, 'utf8').catch(() => '');
  const results: ReportedResult[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<ReportedResult>;
      if (typeof row.id === 'string' && typeof row.passed === 'boolean') {
        results.push({
          id: row.id,
          name: typeof row.name === 'string' ? row.name : row.id,
          passed: row.passed,
          message: typeof row.message === 'string' ? row.message : null,
        });
      }
    } catch {
      // A partly written last line after a kill. The criterion counts as not reported.
    }
  }
  return results;
}
