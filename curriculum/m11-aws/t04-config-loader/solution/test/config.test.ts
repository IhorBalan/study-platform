// Tests for the config loader against the lab emulator. Run them with `npm test`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { DeleteParametersCommand, PutParameterCommand, SSMClient, type ParameterType } from '@aws-sdk/client-ssm';
import { ConfigError, createCredentialsCache, loadConfig } from '../src/config.ts';

const ssm = new SSMClient({});
// The emulator returns every parameter in one page unless MaxResults is set; AWS returns at most 10.
// The loader gets a client that pages like AWS, so these tests exercise pagination.
const pagedSsm: Pick<SSMClient, 'send'> = {
  send: ((command: { constructor: { name: string }; input: { MaxResults?: number } }, options?: unknown) => {
    if (command.constructor.name === 'GetParametersByPathCommand') command.input.MaxResults ??= 10;
    return (ssm.send as (c: unknown, o?: unknown) => Promise<unknown>)(command, options);
  }) as SSMClient['send'],
};
const secrets = new SecretsManagerClient({});
const prefix = `${process.env.AWS_RESOURCE_PREFIX ?? 'dev-'}cfg-${randomUUID().slice(0, 8)}-`;
const parameterNames: string[] = [];
const secretIds: string[] = [];

after(async () => {
  for (let i = 0; i < parameterNames.length; i += 10) {
    await ssm.send(new DeleteParametersCommand({ Names: parameterNames.slice(i, i + 10) }));
  }
  for (const id of secretIds) await secrets.send(new DeleteSecretCommand({ SecretId: id, ForceDeleteWithoutRecovery: true }));
  ssm.destroy();
  secrets.destroy();
});

let n = 0;
async function setup(params: Record<string, [ParameterType, string]>, secret: object | null) {
  const path = `/${prefix}${++n}/orders-api/`;
  for (const [name, [Type, Value]] of Object.entries(params)) {
    await ssm.send(new PutParameterCommand({ Name: path + name, Type, Value }));
    parameterNames.push(path + name);
  }
  const secretId = `${prefix}${n}/db`;
  if (secret) {
    await secrets.send(new CreateSecretCommand({ Name: secretId, SecretString: JSON.stringify(secret) }));
    secretIds.push(secretId);
  }
  return { parameterPath: path, secretId };
}

const DB = { username: 'orders', password: 'p@ss/w:rd', host: 'db.internal', port: 5432, dbname: 'orders' };
const VALID: Record<string, [ParameterType, string]> = {
  port: ['String', '8080'],
  'allowed-origins': ['StringList', 'https://shop.example,https://admin.example'],
  'stripe/webhook-secret': ['SecureString', 'whsec_test123'],
};

test('a valid tree loads, decrypted and typed, across several pages', async () => {
  const flags: Record<string, [ParameterType, string]> = {};
  for (let i = 0; i < 10; i++) flags[`feature/flag-${i}`] = ['String', i % 2 ? 'true' : 'false'];
  const where = await setup({ ...VALID, ...flags }, DB);
  const config = await loadConfig({ ssm: pagedSsm, secrets, ...where });
  assert.equal(config.port, 8080);
  assert.equal(config.logLevel, 'info');
  assert.deepEqual(config.allowedOrigins, ['https://shop.example', 'https://admin.example']);
  assert.equal(config.stripe.webhookSecret, 'whsec_test123');
  assert.equal(Object.keys(config.features).length, 10);
  assert.equal(config.features['flag-1'], true);
  assert.equal(config.database.url, 'postgres://orders:p%40ss%2Fw%3Ard@db.internal:5432/orders');
  assert.equal(config.database.poolMax, 10);
});

test('every problem is reported, by name, without values', async () => {
  const where = await setup({ ...VALID, port: ['String', 'eighty'], 'feature/x': ['String', 'yes'] }, { ...DB, port: 'nope' });
  const error = await loadConfig({ ssm: pagedSsm, secrets, ...where }).then(
    () => assert.fail('expected a ConfigError'),
    (e: unknown) => e,
  );
  assert.ok(error instanceof ConfigError);
  const text = error.issues.join('\n');
  assert.match(text, /port/);
  assert.match(text, /feature\/x/);
  assert.match(text, /secret/);
  assert.ok(!text.includes('eighty') && !text.includes(DB.password));
});

test('a missing secret is a ConfigError', async () => {
  const where = await setup(VALID, null);
  await assert.rejects(() => loadConfig({ ssm: pagedSsm, secrets, ...where }), ConfigError);
});

test('the credentials cache reuses a value and refresh() picks up a rotation', async () => {
  const where = await setup({}, DB);
  const cache = createCredentialsCache({ secrets, secretId: where.secretId, ttlMs: 60_000 });
  assert.equal((await cache.get()).password, DB.password);
  await secrets.send(new PutSecretValueCommand({ SecretId: where.secretId, SecretString: JSON.stringify({ ...DB, password: 'rotated' }) }));
  assert.equal((await cache.get()).password, DB.password);
  assert.equal((await cache.refresh()).password, 'rotated');
  assert.equal((await cache.get()).password, 'rotated');
});
