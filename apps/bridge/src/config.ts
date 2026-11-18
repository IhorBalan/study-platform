import path from 'node:path';
import { z } from 'zod';

/** apps/bridge/{src,dist} -> repository root */
const repoRoot = path.resolve(import.meta.dirname, '../../..');

const ConfigSchema = z.object({
  BRIDGE_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  /** Shared with the worker. `pnpm dev` generates it into .env on first run. */
  BRIDGE_SECRET: z.string().min(24, 'must be at least 24 characters'),
  CURRICULUM_DIR: z.string().default(path.join(repoRoot, 'curriculum')),
  /** Docker network the sandboxes join. It must have no route to the internet. */
  LAB_NETWORK: z.string().default('lab-net'),
  DOCKER_BIN: z.string().default('docker'),
  CLAUDE_BIN: z.string().default('claude'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid bridge configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
