import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParametersByPathCommand, type Parameter, type SSMClient } from '@aws-sdk/client-ssm';
import { z } from 'zod';

export interface AppConfig {
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  allowedOrigins: string[];
  features: Record<string, boolean>;
  stripe: { webhookSecret: string };
  database: { url: string; poolMax: number };
}

export interface DbCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
}

export interface LoadConfigOptions {
  ssm: Pick<SSMClient, 'send'>;
  secrets: Pick<SecretsManagerClient, 'send'>;
  /** The parameter tree, e.g. "/prod/orders-api/". */
  parameterPath: string;
  /** The Secrets Manager secret with the database credentials. */
  secretId: string;
}

/** Every problem found, by parameter or secret name. Never contains a value. */
export class ConfigError extends Error {
  override name = 'ConfigError';
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.issues = issues;
  }
}

const boolString = z.stringbool({ truthy: ['true'], falsy: ['false'] });

/** Keys are parameter names relative to the path, so an issue's path names the parameter. */
const ParametersSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535),
  'log-level': z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  'allowed-origins': z.array(z.url()).min(1),
  'stripe/webhook-secret': z.string().startsWith('whsec_'),
  'db/pool-max': z.coerce.number().int().min(1).max(100).default(10),
});

const FeaturesSchema = z.record(z.string(), boolString);

const CredentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  dbname: z.string().min(1),
});

const describe = (prefix: string, issues: z.core.$ZodIssue[]) =>
  // Built from the path and zod's message only: the received value never appears.
  issues.map((issue) => `${prefix}${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);

async function readParameters(ssm: LoadConfigOptions['ssm'], path: string): Promise<Parameter[]> {
  const all: Parameter[] = [];
  let NextToken: string | undefined;
  do {
    const page = await ssm.send(new GetParametersByPathCommand({ Path: path, Recursive: true, WithDecryption: true, NextToken }));
    all.push(...(page.Parameters ?? []));
    NextToken = page.NextToken;
  } while (NextToken);
  return all;
}

export async function fetchDbCredentials(secrets: LoadConfigOptions['secrets'], secretId: string): Promise<DbCredentials> {
  let raw: string | undefined;
  try {
    raw = (await secrets.send(new GetSecretValueCommand({ SecretId: secretId }))).SecretString;
  } catch (error) {
    if ((error as Error).name === 'ResourceNotFoundException') throw new ConfigError([`secret ${secretId}: not found`]);
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw ?? '');
  } catch {
    throw new ConfigError([`secret ${secretId}: not a JSON object`]);
  }
  const parsed = CredentialsSchema.safeParse(json);
  if (!parsed.success) throw new ConfigError(describe(`secret ${secretId}: `, parsed.error.issues));
  return parsed.data;
}

export function databaseUrl(c: DbCredentials): string {
  return `postgres://${encodeURIComponent(c.username)}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${encodeURIComponent(c.dbname)}`;
}

/**
 * Reads the parameter tree and the database secret once, validates everything and returns a typed
 * config, or throws one ConfigError that lists every problem. Call it before the app listens.
 */
export async function loadConfig({ ssm, secrets, parameterPath, secretId }: LoadConfigOptions): Promise<AppConfig> {
  const base = parameterPath.endsWith('/') ? parameterPath : `${parameterPath}/`;
  const [parameters, credentials] = await Promise.allSettled([readParameters(ssm, base), fetchDbCredentials(secrets, secretId)]);
  if (parameters.status === 'rejected') throw parameters.reason;

  const values: Record<string, string | string[]> = {};
  const features: Record<string, string> = {};
  for (const p of parameters.value) {
    const name = p.Name!.slice(base.length);
    if (name.startsWith('feature/')) features[name.slice('feature/'.length)] = p.Value ?? '';
    else values[name] = p.Type === 'StringList' ? (p.Value ?? '').split(',').map((s) => s.trim()) : (p.Value ?? '');
  }

  const issues: string[] = [];
  const params = ParametersSchema.safeParse(values);
  if (!params.success) issues.push(...describe('', params.error.issues));
  const flags = FeaturesSchema.safeParse(features);
  if (!flags.success) issues.push(...describe('feature/', flags.error.issues));
  if (credentials.status === 'rejected') {
    if (!(credentials.reason instanceof ConfigError)) throw credentials.reason;
    issues.push(...credentials.reason.issues);
  }
  if (issues.length > 0 || !params.success || !flags.success || credentials.status !== 'fulfilled') {
    throw new ConfigError(issues);
  }

  return {
    port: params.data.port,
    logLevel: params.data['log-level'],
    allowedOrigins: params.data['allowed-origins'],
    features: flags.data,
    stripe: { webhookSecret: params.data['stripe/webhook-secret'] },
    database: { url: databaseUrl(credentials.value), poolMax: params.data['db/pool-max'] },
  };
}

export interface CredentialsCacheOptions {
  secrets: LoadConfigOptions['secrets'];
  secretId: string;
  /** How long a fetched value is reused. */
  ttlMs: number;
  now?: () => number;
}

export interface CredentialsCache {
  /** The cached credentials, fetched when missing or older than ttlMs. Concurrent callers share one fetch. */
  get(): Promise<DbCredentials>;
  /** Fetches now, e.g. after the database rejected the password because it was rotated. */
  refresh(): Promise<DbCredentials>;
}

export function createCredentialsCache({ secrets, secretId, ttlMs, now = Date.now }: CredentialsCacheOptions): CredentialsCache {
  let cached: { value: DbCredentials; at: number } | undefined;
  let inFlight: Promise<DbCredentials> | undefined;

  function fetchOnce(): Promise<DbCredentials> {
    inFlight ??= fetchDbCredentials(secrets, secretId)
      .then((value) => {
        cached = { value, at: now() };
        return value;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  return {
    async get() {
      if (cached && now() - cached.at < ttlMs) return cached.value;
      return fetchOnce();
    },
    refresh: fetchOnce,
  };
}
