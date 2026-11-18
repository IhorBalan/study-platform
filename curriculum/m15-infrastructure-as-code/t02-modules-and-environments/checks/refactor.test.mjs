// Checks for "From copy-paste to a module". Static checks over the .tf files: OpenTofu is not run.
// Node built-ins only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { attrValue, block, blocks, configFiles, loadModule, unquote, walk } from './hcl.mjs';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const ENVS = ['dev', 'prod'];

/** Addresses that exist in each environment's state before the refactoring (see the starter). */
const OLD_ADDRESSES = [
  'aws_s3_bucket.invoices',
  'aws_s3_bucket_versioning.invoices',
  'aws_s3_bucket_public_access_block.invoices',
  'aws_sqs_queue.invoice_jobs_dlq',
  'aws_sqs_queue.invoice_jobs',
];

const rel = (file) => path.relative(dir, file) || '.';
const cache = new Map();
function load(d) {
  if (!cache.has(d)) cache.set(d, loadModule(d));
  return cache.get(d);
}

function envDir(env) {
  const d = path.join(dir, 'envs', env);
  assert.ok(configFiles(d).length > 0, `expected .tf files in envs/${env}, found none`);
  return d;
}

/** Module directories under modules/ that contain configuration files. */
function moduleDirs() {
  const root = path.join(dir, 'modules');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name))
    .filter((d) => configFiles(d).length > 0);
}

/** Module calls in an environment whose source is a local path into modules/. */
function localModuleCalls(env) {
  const d = envDir(env);
  const modulesRoot = path.join(dir, 'modules') + path.sep;
  return blocks(load(d).body, 'module').flatMap((m) => {
    const source = unquote(attrValue(m.body, 'source'));
    if (!source || !/^\.\.?\//.test(source)) return [];
    const target = path.resolve(d, source);
    if (!target.startsWith(modulesRoot) || configFiles(target).length === 0) return [];
    return [{ name: m.labels[0], target }];
  });
}

/** The shared module: the one directory both environments call. */
function sharedModule() {
  const dirs = moduleDirs();
  assert.ok(dirs.length > 0, 'expected a module with .tf files in a directory under modules/');
  const used = ENVS.map((env) => new Set(localModuleCalls(env).map((c) => c.target)));
  const shared = dirs.find((d) => used.every((s) => s.has(d)));
  return shared ?? dirs.find((d) => blocks(load(d).body, 'resource', 'aws_s3_bucket').length > 0) ?? dirs[0];
}

test('parses: every .tf file under envs/ and modules/ parses', () => {
  const dirs = [...ENVS.map((e) => path.join(dir, 'envs', e)), ...moduleDirs()];
  const errors = dirs.flatMap((d) => load(d).errors.map((e) => `${rel(e.file)}:${e.line}: ${e.message}`));
  assert.deepEqual(errors, [], 'some files could not be read as HCL');
  for (const env of ENVS) envDir(env);
});

test('module-defined: a module under modules/ declares the bucket and the queues with typed inputs', () => {
  const m = sharedModule();
  const { body } = load(m);
  for (const type of ['aws_s3_bucket', 'aws_sqs_queue']) {
    assert.ok(blocks(body, 'resource', type).length > 0, `expected ${rel(m)} to declare ${type}`);
  }
  const vars = blocks(body, 'variable');
  assert.ok(vars.length > 0, `expected ${rel(m)} to declare input variables`);
  const untyped = vars.filter((v) => !attrValue(v.body, 'type')).map((v) => v.labels[0]);
  assert.deepEqual(untyped, [], `every variable in ${rel(m)} needs a type`);
  assert.ok(blocks(body, 'output').length > 0, `expected ${rel(m)} to declare at least one output`);
});

test('module-has-no-provider: the module configures no provider and no backend', () => {
  const m = sharedModule();
  const { body } = load(m);
  assert.equal(blocks(body, 'provider').length, 0, `${rel(m)} must not contain a provider block; the environments configure the provider`);
  const backends = blocks(body, 'terraform').flatMap((t) => blocks(t.body, 'backend'));
  assert.equal(backends.length, 0, `${rel(m)} must not contain a backend block`);
});

test('envs-use-module: dev and prod both call the same module and declare no copies of its resources', () => {
  const targets = ENVS.map((env) => {
    const calls = localModuleCalls(env);
    assert.ok(calls.length > 0, `expected envs/${env} to call a module from modules/ with a relative source path`);
    return new Set(calls.map((c) => c.target));
  });
  const common = [...targets[0]].filter((t) => targets[1].has(t));
  assert.ok(common.length > 0, 'expected envs/dev and envs/prod to call the same module directory');
  for (const env of ENVS) {
    const leftovers = blocks(load(envDir(env)).body, 'resource')
      .map((r) => r.labels[0])
      .filter((t) => t.startsWith('aws_s3_bucket') || t.startsWith('aws_sqs_queue'));
    assert.deepEqual(leftovers, [], `envs/${env} still declares bucket or queue resources itself`);
  }
});

test('moved-blocks: every existing resource is moved into the module, so nothing is destroyed', () => {
  for (const env of ENVS) {
    const calls = localModuleCalls(env);
    assert.ok(calls.length > 0, `expected envs/${env} to call the module`);
    const byName = new Map(calls.map((c) => [c.name, c.target]));
    const moves = blocks(load(envDir(env)).body, 'moved').map((m) => ({
      from: (attrValue(m.body, 'from') ?? '').trim(),
      to: (attrValue(m.body, 'to') ?? '').trim(),
    }));
    const missing = [];
    for (const address of OLD_ADDRESSES) {
      const [type, name] = address.split('.');
      const ok = moves.some(({ from, to }) => {
        if (from !== address) return false;
        const m = /^module\.([A-Za-z_][\w-]*)(?:\[[^\]]+\])?\.([A-Za-z_][\w-]*)\.([A-Za-z_][\w-]*)(?:\[[^\]]+\])?$/.exec(to);
        if (!m || m[2] !== type || !byName.has(m[1])) return false;
        return blocks(load(byName.get(m[1])).body, 'resource', type, m[3]).length > 0;
      });
      if (!ok) missing.push(address);
    }
    assert.deepEqual(
      missing,
      [],
      `envs/${env}: these addresses need a moved block whose "to" is a resource of the same type that exists in the called module`,
    );
  }
});

test('no-hardcoded-credentials: no access keys anywhere in the configuration', () => {
  const offenders = [];
  const dirs = [...ENVS.map((e) => path.join(dir, 'envs', e)), ...moduleDirs()];
  for (const d of dirs) {
    walk(load(d).body, (item, parents) => {
      if (item.kind !== 'attribute') return;
      const inConfig = parents.some((p) => p.type === 'provider' || p.type === 'backend');
      if (inConfig && ['access_key', 'secret_key', 'token'].includes(item.name)) {
        offenders.push(`${rel(parents[0].file)}:${item.line} ${item.name}`);
      }
    });
    for (const file of configFiles(d)) {
      if (/\b(AKIA|ASIA)[0-9A-Z]{16}\b/.test(fs.readFileSync(file, 'utf8'))) offenders.push(`${rel(file)}: an AWS access key id`);
    }
  }
  assert.deepEqual(offenders, [], 'credentials must come from the environment, not from the configuration');
});

test('remote-backend: each environment has its own locked S3 backend', () => {
  const keys = new Map();
  for (const env of ENVS) {
    const backends = blocks(load(envDir(env)).body, 'terraform').flatMap((t) => blocks(t.body, 'backend', 's3'));
    assert.equal(backends.length, 1, `expected one backend "s3" block in envs/${env}, found ${backends.length}`);
    const b = backends[0].body;
    assert.ok(unquote(attrValue(b, 'bucket')), `envs/${env}: the backend needs a bucket`);
    const key = unquote(attrValue(b, 'key'));
    assert.ok(key, `envs/${env}: the backend needs a key (the path of the state file)`);
    keys.set(env, key);
    const locked = attrValue(b, 'use_lockfile') === 'true' || Boolean(unquote(attrValue(b, 'dynamodb_table')));
    assert.ok(locked, `envs/${env}: the backend has no locking; set use_lockfile = true`);
  }
  assert.notEqual(keys.get('dev'), keys.get('prod'), 'dev and prod must not share a state file: their backend keys are equal');
});

test('prevent-destroy: the bucket in the module cannot be destroyed by a plan', () => {
  const m = sharedModule();
  const { body } = load(m);
  const buckets = blocks(body, 'resource', 'aws_s3_bucket');
  assert.ok(buckets.length > 0, `expected an aws_s3_bucket in ${rel(m)}`);
  const vars = new Map(blocks(body, 'variable').map((v) => [v.labels[0], v]));
  for (const b of buckets) {
    const value = attrValue(block(b.body, 'lifecycle')?.body ?? [], 'prevent_destroy');
    let ok = value === 'true';
    const ref = /^var\.([A-Za-z_][\w-]*)$/.exec(value ?? '');
    if (ref && vars.has(ref[1])) ok = attrValue(vars.get(ref[1]).body, 'default') === 'true';
    assert.ok(ok, `aws_s3_bucket.${b.labels[1]} needs lifecycle { prevent_destroy = true } (or a variable that defaults to true)`);
  }
});
