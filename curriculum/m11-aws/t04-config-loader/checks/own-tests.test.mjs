// The learner's own tests: they must pass, and they must notice two broken loaders.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
// The learner's tests get a prefix of their own inside the run's prefix, so whatever
// they leave behind can be removed without touching anything else. Parameter names start
// with "/" followed by the prefix.
const OWN_PREFIX = `${process.env.AWS_RESOURCE_PREFIX ?? 'check-local-'}own-`;

after(async () => {
  if (!process.env.AWS_ENDPOINT_URL) return;
  const require = createRequire(path.join(dir, 'package.json'));
  const ssmSdk = require('@aws-sdk/client-ssm');
  const smSdk = require('@aws-sdk/client-secrets-manager');
  const ssm = new ssmSdk.SSMClient({});
  const sm = new smSdk.SecretsManagerClient({});
  try {
    const names = [];
    let NextToken;
    do {
      const page = await ssm.send(
        new ssmSdk.DescribeParametersCommand({ ParameterFilters: [{ Key: 'Name', Option: 'BeginsWith', Values: [`/${OWN_PREFIX}`] }], NextToken }),
      );
      names.push(...(page.Parameters ?? []).map((p) => p.Name));
      NextToken = page.NextToken;
    } while (NextToken);
    for (let i = 0; i < names.length; i += 10) {
      await ssm.send(new ssmSdk.DeleteParametersCommand({ Names: names.slice(i, i + 10) })).catch(() => undefined);
    }
    const listed = await sm.send(new smSdk.ListSecretsCommand({ Filters: [{ Key: 'name', Values: [OWN_PREFIX] }] }));
    for (const s of listed.SecretList ?? []) {
      if (s.Name?.startsWith(OWN_PREFIX)) await sm.send(new smSdk.DeleteSecretCommand({ SecretId: s.Name, ForceDeleteWithoutRecovery: true })).catch(() => undefined);
    }
  } finally {
    ssm.destroy();
    sm.destroy();
  }
});

function runTests(cwd) {
  // Without NODE_TEST_CONTEXT the nested run behaves like a top-level `node --test`.
  const { NODE_TEST_CONTEXT, NODE_OPTIONS, ...rest } = process.env;
  const env = { ...rest, AWS_RESOURCE_PREFIX: OWN_PREFIX };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-timeout=20000', '--test-force-exit', 'test/**/*.test.ts'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 50_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
  });
}

const MUTANTS = [
  [
    'loadConfig reads only the first page of parameters',
    'export function loadConfig(options) {\n  const ssm = { send: async (command, opts) => { const res = await options.ssm.send(command, opts); return command?.constructor?.name === "GetParametersByPathCommand" ? { ...res, NextToken: undefined } : res; } };\n  return realLoad({ ...options, ssm });\n}',
  ],
  [
    'SecureString parameters are not decrypted',
    'export function loadConfig(options) {\n  const ssm = { send: (command, opts) => { if (command?.constructor?.name === "GetParametersByPathCommand") command.input.WithDecryption = false; return options.ssm.send(command, opts); } };\n  return realLoad({ ...options, ssm });\n}',
  ],
];

/** A copy of the submission's src/ and test/ whose src/config.ts wraps the real one with a bug. */
function mutantDir(body) {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(path.join(dir, 'src'), path.join(target, 'src'), { recursive: true });
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const real = JSON.stringify(pathToFileURL(path.join(dir, 'src', 'config.ts')).href);
  writeFileSync(
    path.join(target, 'src', 'config.ts'),
    `import { loadConfig as realLoad } from ${real};\nexport * from ${real};\n// Broken on purpose.\n${body}\n`,
  );
  return target;
}

test('own-tests: your tests pass and catch a loader that reads one page and one that does not decrypt', async () => {
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir, { recursive: true }).filter((f) => String(f).endsWith('.test.ts')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.ts (node:test). None were found.');
  assert.ok(existsSync(path.join(dir, 'src', 'config.ts')), 'src/config.ts is missing from the submission.');

  const own = await runTests(dir);
  assert.ok(own.ok, `Your tests fail against your own src/config.ts:\n${own.output.slice(-2500)}`);

  // The mutants run at the same time; your tests should use names with a random part.
  const results = await Promise.all(
    MUTANTS.map(async ([label, body]) => {
      const target = mutantDir(body);
      try {
        return { label, run: await runTests(target) };
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    }),
  );
  const survivors = results.filter((r) => r.run.ok).map((r) => `  - ${r.label}`);
  assert.equal(survivors.length, 0, `Your tests still pass when the loader has these bugs:\n${survivors.join('\n')}\nAdd a test that fails for each.`);
});
