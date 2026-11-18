// Checks for "Load configuration from SSM and Secrets Manager". Node built-ins only; the AWS SDK
// comes from the submission's node_modules. Node runs src/config.ts directly by stripping its types.
// Every parameter and secret name contains AWS_RESOURCE_PREFIX and is deleted in after().
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const RUN = `${process.env.AWS_RESOURCE_PREFIX ?? 'check-local-'}t04-${randomUUID().slice(0, 6)}`;
const requireFromSubmission = createRequire(path.join(dir, 'package.json'));

let ssmSdk;
let smSdk;
let ssm;
let sm;

after(async () => {
  if (!ssm) return;
  const names = [];
  let NextToken;
  do {
    const page = await ssm
      .send(new ssmSdk.DescribeParametersCommand({ ParameterFilters: [{ Key: 'Name', Option: 'BeginsWith', Values: [`/${RUN}`] }], NextToken }))
      .catch(() => ({}));
    names.push(...(page.Parameters ?? []).map((p) => p.Name));
    NextToken = page.NextToken;
  } while (NextToken);
  for (let i = 0; i < names.length; i += 10) {
    await ssm.send(new ssmSdk.DeleteParametersCommand({ Names: names.slice(i, i + 10) })).catch(() => undefined);
  }
  const listed = await sm.send(new smSdk.ListSecretsCommand({ Filters: [{ Key: 'name', Values: [RUN] }] })).catch(() => ({}));
  for (const s of listed.SecretList ?? []) {
    if (s.Name?.startsWith(RUN)) await sm.send(new smSdk.DeleteSecretCommand({ SecretId: s.Name, ForceDeleteWithoutRecovery: true })).catch(() => undefined);
  }
  ssm.destroy();
  sm.destroy();
});

let loaded;
async function load() {
  assert.ok(process.env.AWS_ENDPOINT_URL, 'AWS_ENDPOINT_URL is not set for the check run. Start the emulator with `pnpm lab up aws`.');
  const file = path.join(dir, 'src', 'config.ts');
  assert.ok(existsSync(file), 'src/config.ts is missing from the submission.');
  loaded ??= import(pathToFileURL(file).href);
  const mod = await loaded;
  for (const name of ['loadConfig', 'createCredentialsCache', 'ConfigError']) {
    assert.equal(typeof mod[name], 'function', `src/config.ts must export ${name}.`);
  }
  if (!ssm) {
    ssmSdk = requireFromSubmission('@aws-sdk/client-ssm');
    smSdk = requireFromSubmission('@aws-sdk/client-secrets-manager');
    ssm = new ssmSdk.SSMClient({});
    sm = new smSdk.SecretsManagerClient({});
  }
  return mod;
}

/**
 * The emulator returns every parameter in one page unless MaxResults is set; AWS returns at most 10.
 * This client makes the emulator page like AWS.
 */
function awsLike(client) {
  return {
    send(command, options) {
      if (command?.constructor?.name === 'GetParametersByPathCommand' && command.input && command.input.MaxResults === undefined) {
        command.input.MaxResults = 10;
      }
      return client.send(command, options);
    },
  };
}

function recording(client) {
  const sent = [];
  return {
    sent,
    client: {
      send(command, options) {
        sent.push({ name: command?.constructor?.name, input: command?.input });
        return client.send(command, options);
      },
    },
  };
}

const WEBHOOK = `whsec_${randomUUID().replaceAll('-', '')}`;
const DB = { username: 'orders_app', password: `Pw@${randomUUID().slice(0, 8)}/x:y?z`, host: 'db.internal', port: 5432, dbname: 'orders' };
const BASE = {
  port: ['String', '8080'],
  'allowed-origins': ['StringList', 'https://shop.example,https://admin.example'],
  'stripe/webhook-secret': ['SecureString', WEBHOOK],
};

let n = 0;
/** Writes a parameter tree and (unless secret is null) a secret. Returns the loader options. */
async function setup(params, secret = DB) {
  const tree = `/${RUN}-${++n}/orders-api/`;
  for (const [name, [Type, Value]] of Object.entries(params)) {
    await ssm.send(new ssmSdk.PutParameterCommand({ Name: tree + name, Type, Value }));
  }
  const secretId = `${RUN}-${n}/orders-api/db`;
  if (secret !== null) {
    await sm.send(new smSdk.CreateSecretCommand({ Name: secretId, SecretString: typeof secret === 'string' ? secret : JSON.stringify(secret) }));
  }
  return { parameterPath: tree, secretId };
}

async function loadExpectingError(mod, options) {
  try {
    await mod.loadConfig(options);
  } catch (error) {
    return error;
  }
  assert.fail('loadConfig resolved, but the configuration is invalid. It should throw a ConfigError.');
}

function expectedUrl(c) {
  return `postgres://${encodeURIComponent(c.username)}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.dbname}`;
}

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc found errors:\n${output.slice(0, 3000)}`);
});

test('loads: a valid tree and secret become the typed config, with defaults', async () => {
  const mod = await load();
  const where = await setup({
    ...BASE,
    'log-level': ['String', 'warn'],
    'db/pool-max': ['String', '25'],
    'feature/new-checkout': ['String', 'true'],
    'feature/gift-cards': ['String', 'false'],
    'legacy/ignored': ['String', 'whatever'],
  });
  const config = await mod.loadConfig({ ssm: awsLike(ssm), secrets: sm, ...where });
  assert.deepEqual(
    config,
    {
      port: 8080,
      logLevel: 'warn',
      allowedOrigins: ['https://shop.example', 'https://admin.example'],
      features: { 'new-checkout': true, 'gift-cards': false },
      stripe: { webhookSecret: WEBHOOK },
      database: { url: expectedUrl(DB), poolMax: 25 },
    },
    'loadConfig returned a different config than expected for a complete, valid tree.',
  );

  const minimal = await setup(BASE);
  const defaults = await mod.loadConfig({ ssm: awsLike(ssm), secrets: sm, ...minimal });
  assert.equal(defaults.logLevel, 'info', 'Without log-level, logLevel should default to "info".');
  assert.equal(defaults.database?.poolMax, 10, 'Without db/pool-max, poolMax should default to 10.');
  assert.deepEqual(defaults.features, {}, 'Without feature/ parameters, features should be {}.');
});

test('paginates: every parameter is read, also past the first page of results', async () => {
  const mod = await load();
  const flags = {};
  for (let i = 0; i < 14; i++) flags[`feature/flag-${String(i).padStart(2, '0')}`] = ['String', i % 3 === 0 ? 'true' : 'false'];
  const where = await setup({ ...BASE, ...flags });
  const config = await mod.loadConfig({ ssm: awsLike(ssm), secrets: sm, ...where });
  const count = Object.keys(config.features ?? {}).length;
  assert.equal(count, 14, `17 parameters were stored and 14 of them are feature flags, but features has ${count}. GetParametersByPath returns at most 10 per page: follow NextToken.`);
  assert.equal(config.port, 8080, 'port was lost; read every page.');
});

test('decrypts: SecureString parameters arrive as plain text', async () => {
  const mod = await load();
  const where = await setup(BASE);
  const config = await mod.loadConfig({ ssm: awsLike(ssm), secrets: sm, ...where });
  assert.equal(
    config.stripe?.webhookSecret,
    WEBHOOK,
    'stripe.webhookSecret is not the stored value. Without WithDecryption: true a SecureString comes back encrypted.',
  );
});

test('database-url: the secret becomes a connection URL with every part encoded', async () => {
  const mod = await load();
  const tricky = { ...DB, username: 'svc+orders', password: 'p@ss/w:rd#1?%', port: 6543 };
  const where = await setup(BASE, tricky);
  const config = await mod.loadConfig({ ssm: awsLike(ssm), secrets: sm, ...where });
  assert.equal(config.database?.url, expectedUrl(tricky), 'The URL should encode user name and password with encodeURIComponent and use host, port and dbname from the secret.');
  const parsed = new URL(config.database.url);
  assert.equal(decodeURIComponent(parsed.password), tricky.password, 'The password does not survive a round trip through new URL().');
});

test('reports-all: one ConfigError lists every invalid or missing value by name', async () => {
  const mod = await load();
  const where = await setup(
    {
      port: ['String', '99999'],
      'log-level': ['String', 'verbose'],
      'allowed-origins': ['StringList', 'https://ok.example,not a url'],
      'feature/beta': ['String', 'yes'],
      'db/pool-max': ['String', '0'],
    },
    { ...DB, port: 'not-a-port' },
  );
  const error = await loadExpectingError(mod, { ssm: awsLike(ssm), secrets: sm, ...where });
  assert.ok(error instanceof mod.ConfigError, `Expected a ConfigError, got ${error?.name}: ${String(error?.message).slice(0, 300)}`);
  assert.ok(Array.isArray(error.issues), 'ConfigError should have an issues array of strings.');
  const text = error.issues.join('\n');
  const expected = ['port', 'log-level', 'allowed-origins', 'feature/beta', 'db/pool-max', 'stripe/webhook-secret', where.secretId];
  const missing = expected.filter((name) => !text.includes(name));
  assert.deepEqual(missing, [], `The issues should name every problem. Missing: ${missing.join(', ')}.\nIssues were:\n${text}`);
  assert.ok(error.message.includes('log-level'), 'The error message should contain the issues too.');
});

test('no-leaks: errors never contain a parameter or secret value', async () => {
  const mod = await load();
  const canary = `canary-${randomUUID().slice(0, 8)}`;
  const where = await setup(
    { ...BASE, 'stripe/webhook-secret': ['SecureString', `bad_${WEBHOOK}`], 'log-level': ['String', canary] },
    { ...DB, port: canary },
  );
  const error = await loadExpectingError(mod, { ssm: awsLike(ssm), secrets: sm, ...where });
  const everything = [error?.message, error?.stack, JSON.stringify(error?.issues ?? null), String(error)].join('\n');
  for (const [label, value] of [
    ['an invalid log-level value', canary],
    ['the webhook secret', WEBHOOK],
    ['the database password', DB.password],
  ]) {
    assert.ok(!everything.includes(value), `The error contains ${label}. Name the parameter, never its value.`);
  }

  const broken = await setup(BASE, `{"password":"${DB.password}", oops`);
  const parseError = await loadExpectingError(mod, { ssm: awsLike(ssm), secrets: sm, ...broken });
  assert.ok(parseError instanceof mod.ConfigError, 'A secret that is not valid JSON should give a ConfigError.');
  const text = [parseError.message, parseError.stack, JSON.stringify(parseError.issues ?? null)].join('\n');
  assert.ok(!text.includes(DB.password), 'The error for an unparsable secret contains the password. JSON.parse errors quote the input.');
  assert.ok(text.includes(broken.secretId), 'The error for an unparsable secret should name the secret.');
});

test('missing-secret: a secret that does not exist is a ConfigError naming it', async () => {
  const mod = await load();
  const where = await setup(BASE, null);
  const error = await loadExpectingError(mod, { ssm: awsLike(ssm), secrets: sm, ...where });
  assert.ok(error instanceof mod.ConfigError, `Expected a ConfigError, got ${error?.name}.`);
  assert.ok(error.issues.join('\n').includes(where.secretId), 'The ConfigError should name the missing secret.');
});

test('few-calls: one recursive, decrypted read of the tree and one secret read, no per-parameter calls', async () => {
  const mod = await load();
  const flags = {};
  for (let i = 0; i < 12; i++) flags[`feature/f${i}`] = ['String', 'true'];
  const where = await setup({ ...BASE, ...flags });
  const rs = recording(awsLike(ssm));
  const rm = recording(sm);
  await mod.loadConfig({ ssm: rs.client, secrets: rm.client, ...where });
  const names = rs.sent.map((c) => c.name);
  assert.ok(!names.some((name) => /^GetParameters?Command$/.test(name)), `Read the tree with GetParametersByPath, not parameter by parameter. Sent: ${names.join(', ')}.`);
  const byPath = rs.sent.filter((c) => c.name === 'GetParametersByPathCommand');
  assert.ok(byPath.length >= 2 && byPath.length <= 3, `15 parameters need 2 pages of GetParametersByPath. Sent ${byPath.length}.`);
  assert.ok(byPath.every((c) => c.input?.Recursive === true), 'GetParametersByPath should be called with Recursive: true.');
  assert.ok(byPath.every((c) => c.input?.WithDecryption === true), 'GetParametersByPath should be called with WithDecryption: true.');
  const secretReads = rm.sent.filter((c) => c.name === 'GetSecretValueCommand');
  assert.equal(secretReads.length, 1, `loadConfig should read the secret once, it sent ${secretReads.length} GetSecretValue calls.`);
});

test('cache: credentials are reused within ttlMs, shared by concurrent callers, and refreshed after a rotation', async () => {
  const mod = await load();
  const where = await setup({}, DB);
  const rm = recording(sm);
  let now = 1_000_000;
  const cache = mod.createCredentialsCache({ secrets: rm.client, secretId: where.secretId, ttlMs: 60_000, now: () => now });
  const reads = () => rm.sent.filter((c) => c.name === 'GetSecretValueCommand').length;

  const firsts = await Promise.all([cache.get(), cache.get(), cache.get()]);
  assert.ok(firsts.every((c) => c?.password === DB.password), 'get() should return the parsed credentials ({ username, password, host, port, dbname }).');
  assert.equal(reads(), 1, `Three concurrent get() calls on an empty cache should share one GetSecretValue, there were ${reads()}.`);

  await sm.send(new smSdk.PutSecretValueCommand({ SecretId: where.secretId, SecretString: JSON.stringify({ ...DB, password: 'rotated-1' }) }));
  now += 30_000;
  assert.equal((await cache.get()).password, DB.password, 'Within ttlMs, get() should return the cached value.');
  assert.equal(reads(), 1, 'Within ttlMs, get() should not call Secrets Manager.');

  const refreshed = await cache.refresh();
  assert.equal(refreshed.password, 'rotated-1', 'refresh() should fetch the current secret value.');
  assert.equal((await cache.get()).password, 'rotated-1', 'After refresh(), get() should return the new value.');

  await sm.send(new smSdk.PutSecretValueCommand({ SecretId: where.secretId, SecretString: JSON.stringify({ ...DB, password: 'rotated-2' }) }));
  now += 61_000;
  assert.equal((await cache.get()).password, 'rotated-2', 'After ttlMs has passed, get() should fetch again.');
  assert.equal(reads(), 3, `Expected 3 secret reads in total (first get, refresh, expiry), there were ${reads()}.`);
});
