import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  actionName,
  allUses,
  isPinned,
  jobsOf,
  loadWorkflow,
  permissionWrites,
  runText,
  stepsOf,
  triggers,
} from './workflow.mjs';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');

const FILE = path.join(submissionDir, '.github', 'workflows', 'ci.yml');

let cached;
function workflow() {
  if (cached) return cached;
  assert.ok(fs.existsSync(FILE), 'expected the workflow at .github/workflows/ci.yml, but the file does not exist');
  const wf = loadWorkflow(FILE);
  assert.ok(wf && typeof wf === 'object' && !Array.isArray(wf), 'ci.yml must be a YAML mapping at the top level');
  cached = wf;
  return wf;
}

function verifyJob() {
  const jobs = jobsOf(workflow());
  assert.ok(jobs.verify, `expected a job named "verify", found: ${Object.keys(jobs).join(', ') || 'no jobs'}`);
  return jobs.verify;
}

/** Finds the index of the first step whose command runs the given pnpm script. */
function scriptIndex(steps, script) {
  const re = new RegExp(`(^|[\\s;&|])pnpm\\s+(run\\s+)?${script}(\\s|$)`, 'm');
  return steps.findIndex((s) => re.test(runText(s)));
}

function installIndex(steps) {
  return steps.findIndex((s) => {
    const run = runText(s);
    if (/(^|[\s;&|])pnpm\s+(install|i)\b[^\n]*--frozen-lockfile/m.test(run)) return true;
    // pnpm/setup installs by itself; with require-lockfile it is a frozen install.
    return (
      typeof s.uses === 'string' &&
      actionName(s.uses) === 'pnpm/setup' &&
      String(s.with?.['require-lockfile']) === 'true' &&
      String(s.with?.install) !== 'false'
    );
  });
}

test('workflow-parses: ci.yml exists, is valid YAML and defines jobs', () => {
  const wf = workflow();
  const jobs = jobsOf(wf);
  assert.ok(Object.keys(jobs).length > 0, 'ci.yml must define at least one job under "jobs:"');
  for (const [id, job] of Object.entries(jobs)) {
    assert.ok(job && typeof job === 'object', `job "${id}" must be a mapping`);
    assert.ok(job['runs-on'] || job.uses, `job "${id}" needs "runs-on"`);
  }
});

test('triggers: runs on pull requests and on pushes to main only', () => {
  const on = triggers(workflow());
  assert.ok(!('pull_request_target' in on), 'do not use pull_request_target here: it runs fork code with a privileged token');
  assert.ok('pull_request' in on, `expected a pull_request trigger, found: ${Object.keys(on).join(', ') || 'none'}`);
  assert.ok('push' in on, 'expected a push trigger, so main is verified after every merge');
  const branches = on.push?.branches;
  assert.ok(
    Array.isArray(branches) ? branches.length === 1 && branches[0] === 'main' : branches === 'main',
    `push must be limited to the main branch (branches: [main]), found: ${JSON.stringify(branches ?? 'every branch')}`,
  );
  const allowed = new Set(['pull_request', 'push', 'workflow_dispatch', 'merge_group']);
  const extra = Object.keys(on).filter((e) => !allowed.has(e));
  assert.deepEqual(extra, [], `unexpected triggers: ${extra.join(', ')}`);
});

test('permissions: the token is read-only and limited to repository contents', () => {
  const wf = workflow();
  assert.ok(wf.permissions !== undefined, 'set "permissions:" at the top level of the workflow, so the default token scope does not apply');
  assert.ok(
    wf.permissions && typeof wf.permissions === 'object',
    `top-level permissions must be a mapping of scopes, found: ${JSON.stringify(wf.permissions)}`,
  );
  assert.equal(wf.permissions.contents, 'read', 'top-level permissions must grant "contents: read" so the checkout works');
  assert.deepEqual(permissionWrites(wf.permissions), [], 'top-level permissions must not grant any write scope');
  for (const [id, job] of Object.entries(jobsOf(wf))) {
    assert.deepEqual(permissionWrites(job.permissions), [], `job "${id}" must not grant any write scope`);
  }
});

test('pinned-actions: every action is pinned to a full commit SHA', () => {
  const uses = allUses(workflow());
  assert.ok(uses.length > 0, 'expected the verify job to use at least actions/checkout');
  const unpinned = uses.filter((u) => !isPinned(u.uses)).map((u) => u.uses);
  assert.deepEqual(
    unpinned,
    [],
    `these references can move under you; pin each one to a 40-character commit SHA: ${unpinned.join(', ')}`,
  );
});

test('node-and-pnpm-cache: Node comes from .nvmrc and the pnpm store is cached', () => {
  const steps = stepsOf(verifyJob());
  const names = steps.map((s) => (typeof s.uses === 'string' ? actionName(s.uses) : null));
  assert.ok(names.includes('actions/checkout'), 'the verify job must check out the code with actions/checkout');
  const setupNode = steps.find((s) => typeof s.uses === 'string' && actionName(s.uses) === 'actions/setup-node');
  const pnpmSetup = steps.find((s) => typeof s.uses === 'string' && actionName(s.uses) === 'pnpm/setup');
  const actionSetup = steps.find((s) => typeof s.uses === 'string' && actionName(s.uses) === 'pnpm/action-setup');
  assert.ok(setupNode || pnpmSetup, 'install Node with actions/setup-node (or pnpm/setup with a runtime)');
  assert.ok(actionSetup || pnpmSetup, 'install pnpm with pnpm/action-setup or pnpm/setup');

  if (setupNode) {
    const w = setupNode.with ?? {};
    assert.ok(
      w['node-version-file'] === '.nvmrc' || /^(24|26)(\.|$)/.test(String(w['node-version'] ?? '')),
      `setup-node must read the version from .nvmrc (node-version-file: .nvmrc), found: ${JSON.stringify(w)}`,
    );
    if (actionSetup) {
      assert.ok(
        names.indexOf('pnpm/action-setup') < names.indexOf('actions/setup-node'),
        'pnpm/action-setup must run before actions/setup-node; setup-node needs pnpm on the PATH to find the store for its cache',
      );
    }
  }

  const cached =
    setupNode?.with?.cache === 'pnpm' ||
    String(actionSetup?.with?.cache) === 'true' ||
    String(pnpmSetup?.with?.cache) === 'true' ||
    steps.some((s) => typeof s.uses === 'string' && actionName(s.uses) === 'actions/cache' && /pnpm/.test(String(s.with?.path ?? '')));
  assert.ok(cached, 'the pnpm store is not cached; every run would download all packages again');
});

test('step-order: install, lint, typecheck, test and build run in that order', () => {
  const steps = stepsOf(verifyJob());
  const order = [
    ['pnpm install --frozen-lockfile', installIndex(steps)],
    ['pnpm lint', scriptIndex(steps, 'lint')],
    ['pnpm typecheck', scriptIndex(steps, 'typecheck')],
    ['pnpm test', scriptIndex(steps, 'test')],
    ['pnpm build', scriptIndex(steps, 'build')],
  ];
  for (const [label, index] of order) {
    assert.ok(index !== -1, `the verify job has no step that runs "${label}"`);
  }
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      order[i - 1][1] < order[i][1],
      `"${order[i - 1][0]}" must run in an earlier step than "${order[i][0]}"`,
    );
  }
  for (const s of steps) {
    assert.notEqual(String(s['continue-on-error']), 'true', 'no step may use continue-on-error: a failing check must fail the run');
    assert.ok(!/\|\|\s*(true|exit 0|:)\s*$/m.test(runText(s)), `this step hides failures: ${runText(s).trim()}`);
  }
});

test('postgres-service: tests get a healthy PostgreSQL 18 service and its DATABASE_URL', () => {
  const job = verifyJob();
  const services = job.services && typeof job.services === 'object' ? Object.values(job.services) : [];
  const pg = services.find((s) => s && /^(docker\.io\/(library\/)?)?postgres:18([.\-]|$)/.test(String(s.image ?? '')));
  assert.ok(
    pg,
    `expected a service container with a postgres:18 image, found: ${services.map((s) => s?.image).join(', ') || 'no services'}`,
  );
  assert.ok(pg.env?.POSTGRES_PASSWORD, 'the postgres image will not start without POSTGRES_PASSWORD in the service env');
  const ports = (Array.isArray(pg.ports) ? pg.ports : []).map(String);
  assert.ok(ports.some((p) => /^5432:5432$/.test(p)), `map the service port so steps reach it on localhost ("5432:5432"), found: ${JSON.stringify(pg.ports ?? [])}`);
  const options = String(pg.options ?? '');
  assert.ok(
    /--health-cmd/.test(options) && /pg_isready/.test(options),
    'add a health check (options: --health-cmd pg_isready ...) so the steps wait until Postgres accepts connections',
  );

  const steps = stepsOf(job);
  const testStep = steps[scriptIndex(steps, 'test')];
  const url = testStep?.env?.DATABASE_URL ?? job.env?.DATABASE_URL ?? workflow().env?.DATABASE_URL;
  assert.ok(url, 'set DATABASE_URL for the test step (in the step, job or workflow env)');
  assert.match(
    String(url),
    /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1):5432\/\w+/,
    `DATABASE_URL must point at the service on localhost:5432, found: ${url}`,
  );
});

test('fast-feedback: superseded runs are cancelled and the job has a timeout', () => {
  const wf = workflow();
  const job = verifyJob();
  const concurrency = wf.concurrency ?? job.concurrency;
  assert.ok(concurrency && typeof concurrency === 'object', 'add a concurrency group so a new push cancels the run it replaces');
  assert.match(String(concurrency.group ?? ''), /github\.(ref|head_ref)/, 'the concurrency group must include the branch (github.ref), or every branch would cancel the others');
  assert.equal(String(concurrency['cancel-in-progress']), 'true', 'set cancel-in-progress: true');
  assert.match(String(job['runs-on']), /^ubuntu-/, `the verify job must run on a Linux runner, found: ${job['runs-on']}`);
  const timeout = Number(job['timeout-minutes']);
  assert.ok(
    Number.isFinite(timeout) && timeout > 0 && timeout <= 20,
    `set timeout-minutes on the verify job to 20 or less (the default is 360), found: ${job['timeout-minutes']}`,
  );
});
