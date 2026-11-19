// Starts full mode with the host's time zone. A container runs in UTC unless it
// is told otherwise, and "today" for review limits, streaks and Stats must be
// the learner's local day (D-082). The zone is read on every start, not stored
// in .env, so it follows the machine when it travels.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const zone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const result = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infra/compose/full.compose.yaml',
    'up',
    '-d',
    '--build',
    '--wait',
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, TZ: zone } },
);
if (result.error) {
  console.error(`Could not run docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
