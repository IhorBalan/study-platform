import { loadCurriculum } from '@study/curriculum';
import { loadConfig } from './config.js';
import { createBridgeServer } from './server.js';
import { sweepLeftovers } from './sweep.js';

const config = loadConfig();
const curriculum = await loadCurriculum(config.CURRICULUM_DIR);
if (curriculum.issues.length > 0) {
  for (const issue of curriculum.issues) console.error(`${issue.file}: ${issue.message}`);
  throw new Error('The curriculum has errors. Run "pnpm curriculum:check".');
}

// A check run that an earlier bridge did not finish can leave a container running.
const swept = await sweepLeftovers(config);
if (swept.containers + swept.folders + swept.databases > 0) {
  console.log(
    `[bridge] cleaned up after interrupted checks: ${swept.containers} containers, ${swept.folders} folders, ${swept.databases} databases`,
  );
}

const server = createBridgeServer({ config, curriculum });
// Loopback only. In full mode the worker container reaches it through host.docker.internal.
server.listen(config.BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`[bridge] listening on http://127.0.0.1:${config.BRIDGE_PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
