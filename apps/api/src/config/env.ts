import path from 'node:path';
import { z } from 'zod';

/** apps/api/{src,dist}/config -> repository root */
const repoRoot = path.resolve(import.meta.dirname, '../../../..');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().default('postgres://study:study@localhost:54320/study'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  CURRICULUM_DIR: z.string().default(path.join(repoRoot, 'curriculum')),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses the environment once at start-up and fails with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
