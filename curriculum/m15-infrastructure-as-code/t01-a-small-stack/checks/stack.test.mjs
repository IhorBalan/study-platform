// Checks for "A small stack". Static checks over the .tf files: OpenTofu is not run.
// Node built-ins only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { attrValue, block, blocks, isLiteralString, loadModule, references, unquote, walk, objectStringField } from './hcl.mjs';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');

let cached;
function config() {
  if (cached) return cached;
  const mod = loadModule(dir);
  assert.ok(mod.files.length > 0, 'expected .tf files at the top level of the submission, found none');
  cached = mod;
  return mod;
}

const resources = (type) => blocks(config().body, 'resource', type);
const rel = (file) => path.relative(dir, file);

/** Map of local name -> expression, across all locals blocks. */
function localsMap() {
  const map = new Map();
  for (const l of blocks(config().body, 'locals')) {
    for (const item of l.body) if (item.kind === 'attribute') map.set(item.name, item.value);
  }
  return map;
}

/** Variables an expression depends on, following locals. */
function varsBehind(expr, seen = new Set()) {
  const out = new Set(references(expr, 'var'));
  const locals = localsMap();
  for (const name of references(expr, 'local')) {
    if (seen.has(name) || !locals.has(name)) continue;
    seen.add(name);
    for (const v of varsBehind(locals.get(name), seen)) out.add(v);
  }
  return out;
}

const bucketNames = () => new Set(resources('aws_s3_bucket').map((b) => b.labels[1]));
const refsTo = (expr, type) => [...(expr ?? '').matchAll(new RegExp(`(?<![\\w.])${type}\\.([A-Za-z_][\\w-]*)\\b`, 'g'))].map((m) => m[1]);

function awsProvider() {
  const providers = blocks(config().body, 'provider', 'aws').filter((p) => attrValue(p.body, 'alias') === undefined);
  assert.equal(providers.length, 1, `expected one provider "aws" block without an alias, found ${providers.length}`);
  return providers[0];
}

test('parses: every .tf file parses and the configuration declares resources', () => {
  const { errors, body } = config();
  assert.deepEqual(
    errors.map((e) => `${rel(e.file)}:${e.line}: ${e.message}`),
    [],
    'some files could not be read as HCL',
  );
  assert.ok(blocks(body, 'resource').length > 0, 'expected at least one resource block, found none');
});

test('version-constraints: OpenTofu and the AWS provider have version constraints', () => {
  const tf = blocks(config().body, 'terraform');
  assert.ok(tf.length > 0, 'expected a terraform block');
  const required = tf.map((t) => attrValue(t.body, 'required_version')).find(Boolean);
  assert.ok(required && /\d/.test(unquote(required) ?? ''), 'expected required_version with a version constraint in the terraform block');
  const rp = tf.flatMap((t) => blocks(t.body, 'required_providers'));
  const aws = rp.map((b) => attrValue(b.body, 'aws')).find(Boolean);
  assert.ok(aws, 'expected an "aws" entry in required_providers');
  const source = objectStringField(aws, 'source') ?? '';
  assert.match(source, /(^|\/)hashicorp\/aws$/, `expected the aws provider's source to be hashicorp/aws, found ${JSON.stringify(source)}`);
  const version = objectStringField(aws, 'version') ?? '';
  assert.match(version, /\d/, 'expected a version constraint (for example a pessimistic "~>" one) on the aws provider');
});

test('emulator-provider: the provider reaches the emulator through a variable', () => {
  const p = awsProvider();
  const endpoints = block(p.body, 'endpoints');
  assert.ok(endpoints, 'expected an endpoints block in provider "aws"');
  for (const service of ['s3', 'sqs', 'ssm']) {
    const value = attrValue(endpoints.body, service);
    assert.ok(value, `expected an endpoint for ${service} in the endpoints block`);
    assert.ok(varsBehind(value).size > 0, `the ${service} endpoint must come from an input variable (directly or through a local), found ${value}`);
  }
  for (const flag of ['s3_use_path_style', 'skip_credentials_validation', 'skip_requesting_account_id']) {
    const value = attrValue(p.body, flag);
    assert.ok(
      value === 'true' || varsBehind(value ?? '').size > 0,
      `expected ${flag} to be true for the emulator, found ${value ?? 'nothing'}`,
    );
  }
});

test('no-hardcoded-credentials: no access keys in the configuration', () => {
  const offenders = [];
  walk(config().body, (item, parents) => {
    if (item.kind !== 'attribute') return;
    const inProvider = parents.some((p) => p.type === 'provider' || p.type === 'backend');
    if (inProvider && ['access_key', 'secret_key', 'token'].includes(item.name)) {
      offenders.push(`${rel(item.file ?? parents[0].file)}:${item.line} ${item.name}`);
    }
  });
  for (const file of config().files) {
    const text = fs.readFileSync(file, 'utf8');
    if (/\b(AKIA|ASIA)[0-9A-Z]{16}\b/.test(text)) offenders.push(`${rel(file)}: an AWS access key id`);
  }
  assert.deepEqual(offenders, [], 'credentials must come from the environment, not from the configuration');
});

test('typed-variables: every variable declares a type, and there is an environment variable', () => {
  const vars = blocks(config().body, 'variable');
  assert.ok(vars.some((v) => v.labels[0] === 'environment'), 'expected a variable named "environment"');
  const untyped = vars.filter((v) => !attrValue(v.body, 'type')).map((v) => v.labels[0]);
  assert.deepEqual(untyped, [], 'every variable needs a type');
});

test('bucket-versioning: the bucket has versioning enabled', () => {
  const names = bucketNames();
  assert.ok(names.size > 0, 'expected an aws_s3_bucket resource');
  const ok = resources('aws_s3_bucket_versioning').some((v) => {
    const target = refsTo(attrValue(v.body, 'bucket'), 'aws_s3_bucket');
    const status = attrValue(block(v.body, 'versioning_configuration')?.body ?? [], 'status');
    return target.some((t) => names.has(t)) && unquote(status) === 'Enabled';
  });
  assert.ok(ok, 'expected an aws_s3_bucket_versioning resource for the bucket with status "Enabled"');
});

test('bucket-lifecycle: the bucket has an enabled lifecycle rule with an action', () => {
  const names = bucketNames();
  assert.ok(names.size > 0, 'expected an aws_s3_bucket resource');
  const actions = ['expiration', 'noncurrent_version_expiration', 'abort_incomplete_multipart_upload', 'transition', 'noncurrent_version_transition'];
  const ok = resources('aws_s3_bucket_lifecycle_configuration').some((lc) => {
    const target = refsTo(attrValue(lc.body, 'bucket'), 'aws_s3_bucket');
    if (!target.some((t) => names.has(t))) return false;
    return blocks(lc.body, 'rule').some(
      (r) => unquote(attrValue(r.body, 'status')) === 'Enabled' && actions.some((a) => block(r.body, a)),
    );
  });
  assert.ok(ok, 'expected an aws_s3_bucket_lifecycle_configuration for the bucket with a rule that is "Enabled" and has at least one action');
});

test('queue-with-dlq: a queue sends failed messages to a dead-letter queue', () => {
  const queues = new Set(resources('aws_sqs_queue').map((q) => q.labels[1]));
  assert.ok(queues.size >= 2, `expected two aws_sqs_queue resources (a queue and its dead-letter queue), found ${queues.size}`);
  const policies = [];
  for (const q of resources('aws_sqs_queue')) {
    const p = attrValue(q.body, 'redrive_policy');
    if (p) policies.push({ source: q.labels[1], policy: p });
  }
  for (const r of resources('aws_sqs_queue_redrive_policy')) {
    const source = refsTo(attrValue(r.body, 'queue_url'), 'aws_sqs_queue')[0];
    policies.push({ source, policy: attrValue(r.body, 'redrive_policy') ?? '' });
  }
  assert.ok(policies.length > 0, 'expected a redrive policy on the queue');
  const good = policies.find(({ source, policy }) => {
    if (!/deadLetterTargetArn/.test(policy) || !/maxReceiveCount/.test(policy)) return false;
    const targets = [...policy.matchAll(/aws_sqs_queue\.([A-Za-z_][\w-]*)\.arn/g)].map((m) => m[1]);
    return targets.some((t) => queues.has(t) && t !== source);
  });
  assert.ok(good, "expected a redrive policy with deadLetterTargetArn set to the other queue's arn and a maxReceiveCount");
  assert.doesNotMatch(good.policy, /"?maxReceiveCount"?\s*[=:]\s*"/, 'maxReceiveCount must be a number, not a quoted string');
});

test('ssm-parameter: an SSM parameter is declared without a secret in the code', () => {
  const params = resources('aws_ssm_parameter');
  assert.ok(params.length > 0, 'expected an aws_ssm_parameter resource');
  for (const p of params) {
    const id = p.labels[1];
    assert.ok(attrValue(p.body, 'name'), `aws_ssm_parameter.${id} needs a name`);
    const type = unquote(attrValue(p.body, 'type'));
    assert.ok(['String', 'StringList', 'SecureString'].includes(type), `aws_ssm_parameter.${id} needs a type of String, StringList or SecureString`);
    const value = attrValue(p.body, 'value') ?? attrValue(p.body, 'insecure_value') ?? attrValue(p.body, 'value_wo');
    assert.ok(value, `aws_ssm_parameter.${id} needs a value`);
    if (type === 'SecureString') {
      assert.ok(!isLiteralString(value), `aws_ssm_parameter.${id} is a SecureString whose value is written in the file`);
    }
  }
});

test('names-from-inputs: resource names include the environment', () => {
  const checks = [
    ['aws_s3_bucket', ['bucket', 'bucket_prefix']],
    ['aws_sqs_queue', ['name', 'name_prefix']],
    ['aws_ssm_parameter', ['name']],
  ];
  const problems = [];
  for (const [type, attrs] of checks) {
    if (resources(type).length === 0) problems.push(`${type} (none declared)`);
    for (const r of resources(type)) {
      const value = attrs.map((a) => attrValue(r.body, a)).find(Boolean);
      if (!value || !varsBehind(value).has('environment')) problems.push(`${type}.${r.labels[1]}`);
    }
  }
  assert.deepEqual(problems, [], 'these resources need a name built from var.environment (directly or through a local)');
});

test('tags-from-local: tags come from a local that includes the environment', () => {
  const p = awsProvider();
  const defaultTags = attrValue(block(p.body, 'default_tags')?.body ?? [], 'tags');
  let exprs;
  if (defaultTags && references(defaultTags, 'local').length > 0) {
    exprs = [defaultTags];
  } else {
    const missing = [];
    exprs = [];
    for (const type of ['aws_s3_bucket', 'aws_sqs_queue', 'aws_ssm_parameter']) {
      for (const r of resources(type)) {
        const tags = attrValue(r.body, 'tags');
        if (!tags || references(tags, 'local').length === 0) missing.push(`${type}.${r.labels[1]}`);
        else exprs.push(tags);
      }
    }
    assert.deepEqual(missing, [], 'expected default_tags in the provider, or tags on these resources, taken from a local');
  }
  assert.ok(exprs.length > 0, 'expected tags taken from a local');
  assert.ok(
    exprs.every((e) => varsBehind(e).has('environment')),
    'the tags local should include the environment (var.environment)',
  );
});

test('outputs: the bucket, the queue URL and the parameter are outputs', () => {
  const values = blocks(config().body, 'output').map((o) => attrValue(o.body, 'value') ?? '');
  assert.ok(values.some((v) => /aws_s3_bucket\.[\w-]+\.(bucket|id)\b/.test(v)), 'expected an output with the bucket name');
  assert.ok(values.some((v) => /aws_sqs_queue\.[\w-]+\.(url|id)\b/.test(v)), 'expected an output with the queue URL');
  assert.ok(values.some((v) => /aws_ssm_parameter\.[\w-]+\.(name|id|arn)\b/.test(v)), 'expected an output with the parameter name');
});
