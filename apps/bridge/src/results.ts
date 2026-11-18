import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
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

/**
 * Total size of the regular files in a folder and its subfolders. Links are
 * never followed. Anything that is not a plain file or folder (a symbolic link,
 * a pipe, a device) has no place in a results folder and counts as infinite.
 */
export async function folderBytes(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await folderBytes(full);
    } else if (entry.isFile()) {
      total += await lstat(full).then(
        (s) => s.size,
        () => 0,
      );
    } else {
      return Infinity;
    }
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
 * Reads at most `limit` bytes of a file the sandbox wrote. Returns `null` when
 * the file is larger, or is not a regular file.
 *
 * The sandbox controls this path, so it may be a symbolic link to a host file
 * or to /dev/zero, or a named pipe. The file is opened without following links
 * and without blocking, and it is checked and read through the same handle, so
 * what was checked is what is read.
 */
async function readBounded(file: string, limit: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    // No file means the checks reported nothing. A link (ELOOP) is refused.
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) return null;
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    // The file may have grown between the size check and the read.
    return length > limit ? null : buffer.toString('utf8', 0, length);
  } finally {
    await handle.close();
  }
}

/**
 * Reads the results the check suite reported. Returns `null` when the file is
 * not something a check suite writes: too large, a link, or a special file.
 */
export async function readResults(
  file: string,
  limit = MAX_RESULTS_BYTES,
): Promise<ReportedResult[] | null> {
  const text = await readBounded(file, limit);
  if (text === null) return null;
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
