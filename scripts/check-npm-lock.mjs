// Applies the workspace's supply-chain rules to an npm package-lock.json, which
// pnpm's own checks do not cover (the sandbox runner image is installed with npm).
//   node scripts/check-npm-lock.mjs infra/docker/runner-nest/package-lock.json
// Fails when an entry is not from the npm registry, has no integrity hash, or was
// published less than MIN_AGE_MINUTES ago (same window as minimumReleaseAge). S-014.
import { readFileSync } from 'node:fs';

const MIN_AGE_MINUTES = 1440;
const REGISTRY = 'https://registry.npmjs.org/';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-npm-lock.mjs <package-lock.json>');
  process.exit(2);
}

const lock = JSON.parse(readFileSync(file, 'utf8'));
const entries = Object.entries(lock.packages ?? {})
  .filter(([key, meta]) => key !== '' && !meta.link)
  .map(([key, meta]) => ({ name: meta.name ?? key.split('node_modules/').pop(), ...meta }));

const problems = [];
for (const e of entries) {
  if (!e.resolved?.startsWith(REGISTRY))
    problems.push(`${e.name}@${e.version}: not from the npm registry (${e.resolved})`);
  if (!e.integrity) problems.push(`${e.name}@${e.version}: no integrity hash`);
}

const unique = [...new Map(entries.map((e) => [`${e.name}@${e.version}`, e])).values()];
const cutoff = Date.now() - MIN_AGE_MINUTES * 60_000;
const times = new Map();
async function publishedAt(name) {
  if (!times.has(name)) {
    times.set(
      name,
      fetch(`${REGISTRY}${name.replace('/', '%2f')}`).then(async (res) => {
        if (!res.ok) throw new Error(`${name}: registry answered ${res.status}`);
        return (await res.json()).time ?? {};
      }),
    );
  }
  return times.get(name);
}

const queue = [...unique];
async function worker() {
  for (let e = queue.shift(); e; e = queue.shift()) {
    const time = (await publishedAt(e.name))[e.version];
    if (!time) problems.push(`${e.name}@${e.version}: no publish time on the registry`);
    else if (Date.parse(time) > cutoff)
      problems.push(
        `${e.name}@${e.version}: published ${time}, inside the ${MIN_AGE_MINUTES / 60} h release-age window`,
      );
  }
}
await Promise.all(Array.from({ length: 16 }, worker));

if (problems.length > 0) {
  console.error(`${file}: ${problems.length} problem(s)\n  ${problems.sort().join('\n  ')}`);
  process.exit(1);
}
console.log(
  `${file}: ${unique.length} packages pass (registry, integrity, ${MIN_AGE_MINUTES / 60} h release age)`,
);
