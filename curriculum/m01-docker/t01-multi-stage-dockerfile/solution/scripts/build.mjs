// Stand-in for a real build step (tsc, a bundler): produces dist/ from src/.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dist = new URL('../dist/', import.meta.url);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(new URL('../src/', import.meta.url), dist, { recursive: true });
writeFileSync(
  new URL('build-info.json', dist),
  JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString() }, null, 2),
);

console.log(`built ${pkg.name}@${pkg.version} into dist/`);
