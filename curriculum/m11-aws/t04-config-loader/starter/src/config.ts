import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParametersByPathCommand, type SSMClient } from '@aws-sdk/client-ssm';
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

/**
 * Reads the parameter tree and the database secret once, validates everything and returns a typed
 * config, or throws one ConfigError that lists every problem.
 */
export async function loadConfig({ ssm, secrets, parameterPath, secretId }: LoadConfigOptions): Promise<AppConfig> {
  // TODO: read every parameter under parameterPath (all pages, nested names, decrypted).
  const page = await ssm.send(new GetParametersByPathCommand({ Path: parameterPath }));
  // TODO: read and validate the secret; build the database URL.
  // TODO: validate with zod, collect every issue, and throw one ConfigError.
  void page;
  void secrets;
  void secretId;
  void z;
  void GetSecretValueCommand;
  throw new Error('TODO: loadConfig');
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

export function createCredentialsCache(options: CredentialsCacheOptions): CredentialsCache {
  // TODO
  return {
    get: () => Promise.reject(new Error(`TODO: cache for ${options.secretId}`)),
    refresh: () => Promise.reject(new Error(`TODO: cache for ${options.secretId}`)),
  };
}
