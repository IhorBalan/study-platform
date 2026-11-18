import { z } from 'zod';

// Environment variables are always strings, so numbers are coerced and then checked.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MAX_NOTES: z.coerce.number().int().min(1).default(100),
  ADMIN_TOKEN: z.string().min(16),
});

/** The configuration the app runs with, after parsing. */
export type Env = z.infer<typeof EnvSchema>;

/** Injection token for the parsed configuration. */
export const ENV = Symbol('ENV');

/**
 * Parses the environment once and reports every problem in one message.
 * Only variable names and zod's messages are printed. Zod's messages describe
 * the expected shape and never echo the received value, so a bad secret stays
 * out of the logs.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return Object.freeze(parsed.data);
}
