// Tests for the config loader against the lab emulator. Run them with `npm test`.
// Parameter and secret names contain AWS_RESOURCE_PREFIX; everything is deleted in after().
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { DeleteParametersCommand, PutParameterCommand, SSMClient, type ParameterType } from '@aws-sdk/client-ssm';
import { loadConfig } from '../src/config.ts';

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

test('a valid tree loads', async () => {
  const where = await setup(VALID, DB);
  const config = await loadConfig({ ssm: pagedSsm, secrets, ...where });
  assert.equal(config.port, 8080);
});

// TODO: more than 10 parameters are all read (pagination), and SecureStrings arrive decrypted.
// TODO: every problem is reported by name, and no value appears in the error.
// TODO: a missing secret is a ConfigError.
// TODO: the credentials cache reuses a value, and refresh() picks up a rotation.
