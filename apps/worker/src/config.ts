import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://study:study@localhost:54320/study'),
  BRIDGE_URL: z.string().url().default('http://localhost:4100'),
  BRIDGE_SECRET: z.string().default(''),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid worker configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
