/** The configuration the app runs with, after parsing. */
export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  MAX_NOTES: number;
  ADMIN_TOKEN: string;
}

/** Injection token for the parsed configuration. */
export const ENV = Symbol('ENV');

// TODO: write loadEnv. It parses and validates `source` and returns an Env.
// When anything is invalid it throws one Error that names every variable at
// fault, and never includes the value of ADMIN_TOKEN.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return source as unknown as Env;
}

// TODO: provide the result of loadEnv under the ENV token (a module with a
// useFactory provider) so that Nest calls it while the app is being created.
