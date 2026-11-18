// Creates .env from .env.example on first run and fills in a random secret for
// the host bridge. Safe to run repeatedly: existing values are never changed.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envPath = path.join(root, '.env');

let text = existsSync(envPath)
  ? readFileSync(envPath, 'utf8')
  : readFileSync(path.join(root, '.env.example'), 'utf8');
const created = !existsSync(envPath);

const hasSecret = /^BRIDGE_SECRET=.{24,}$/m.test(text);
if (!hasSecret) {
  const line = `BRIDGE_SECRET=${randomBytes(32).toString('hex')}`;
  text = /^#?\s*BRIDGE_SECRET=.*$/m.test(text)
    ? text.replace(/^#?\s*BRIDGE_SECRET=.*$/m, line)
    : `${text.trimEnd()}\n${line}\n`;
}

if (created || !hasSecret) {
  writeFileSync(envPath, text, { mode: 0o600 });
  console.log(created ? 'Created .env from .env.example.' : 'Added a bridge secret to .env.');
}
