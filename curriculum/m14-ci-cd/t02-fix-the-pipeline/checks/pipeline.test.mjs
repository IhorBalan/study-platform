import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  actionName,
  allUses,
  asList,
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
  assert.ok(fs.existsSync(FILE), 'expected the workflow at .github/workflows/ci.yml');
  const wf = loadWorkflow(FILE);
  assert.ok(wf && typeof wf === 'object' && !Array.isArray(wf), 'ci.yml must be a YAML mapping at the top level');
  cached = wf;
  return wf;
}

function job(id) {
  const jobs = jobsOf(workflow());
  assert.ok(jobs[id], `expected a job named "${id}", found: ${Object.keys(jobs).join(', ') || 'no jobs'}`);
  return jobs[id];
}

const usesAction = (step, name) => typeof step.uses === 'string' && actionName(step.uses) === name;

/** Values a matrix key can take, including those added by `include`. */
function matrixValues(j, key) {
  const m = j.strategy?.matrix;
  if (!m || typeof m !== 'object') return [];
  const values = asList(m[key]);
  for (const inc of asList(m.include)) if (inc && key in inc) values.push(inc[key]);
  return values.map(String);
}

test('safe-triggers: fork pull requests run unprivileged and pushes build main only', () => {
  const on = triggers(workflow());
  assert.ok(
    !('pull_request_target' in on),
    'pull_request_target is still a trigger: together with a checkout of the pull request head it runs code from a fork with a write token and the repository secrets',
  );
  assert.ok('pull_request' in on, `expected a pull_request trigger, found: ${Object.keys(on).join(', ') || 'none'}`);
  assert.ok('push' in on, 'expected a push trigger so main is verified and the image is built after a merge');
  const branches = asList(on.push?.branches);
  assert.deepEqual(branches, ['main'], `push must be limited to main, found: ${JSON.stringify(on.push?.branches ?? 'every branch')}`);
});

test('least-privilege: the token is read-only except for the job that pushes the image', () => {
  const wf = workflow();
  assert.ok(
    wf.permissions && typeof wf.permissions === 'object',
    `the workflow-level permissions must be a mapping with contents: read, found: ${JSON.stringify(wf.permissions ?? 'none (repository default)')}`,
  );
  assert.equal(wf.permissions.contents, 'read', 'the workflow-level permissions must grant contents: read');
  assert.deepEqual(permissionWrites(wf.permissions), [], 'the workflow-level permissions must not grant any write scope');
  assert.deepEqual(permissionWrites(job('verify').permissions), [], 'the verify job must not grant any write scope');
  const imagePerms = job('image').permissions;
  const writes = permissionWrites(imagePerms);
  assert.deepEqual(writes, ['packages'], `the image job needs packages: write and no other write scope, found writes: ${writes.join(', ') || 'none'}`);
  assert.equal(imagePerms.contents, 'read', 'job-level permissions replace the workflow ones, so the image job also needs contents: read for the checkout');
});

test('pinned-actions: every action is pinned to a full commit SHA', () => {
  const uses = allUses(workflow());
  const unpinned = uses.filter((u) => !isPinned(u.uses)).map((u) => u.uses);
  assert.deepEqual(unpinned, [], `pin each of these to a 40-character commit SHA: ${unpinned.join(', ')}`);
});

test('failures-fail: a failing lint or test fails the run', () => {
  const steps = stepsOf(job('verify'));
  for (const id of Object.keys(jobsOf(workflow()))) {
    assert.notEqual(String(job(id)['continue-on-error']), 'true', `job "${id}" must not use continue-on-error`);
    for (const s of stepsOf(job(id))) {
      assert.notEqual(String(s['continue-on-error']), 'true', `a step in job "${id}" still uses continue-on-error`);
      assert.ok(!/\|\|\s*(true|exit 0|:)\s*($|;|&&)/m.test(runText(s)), `this step hides its failure: ${runText(s).trim()}`);
    }
  }
  for (const script of ['lint', 'typecheck', 'test', 'build']) {
    const re = new RegExp(`(^|[\\s;&|])pnpm\\s+(run\\s+)?${script}(\\s|$)`, 'm');
    assert.ok(steps.some((s) => re.test(runText(s))), `the verify job must still run "pnpm ${script}"`);
  }
  const install = steps.findIndex((s) => /pnpm\s+(install|i)\b[^\n]*--frozen-lockfile/.test(runText(s)));
  assert.ok(install !== -1, 'install with "pnpm install --frozen-lockfile", so a lockfile out of step with package.json fails the run');
});

test('no-injection: untrusted input and secrets never appear inside run scripts', () => {
  const bad = [];
  for (const [id, j] of Object.entries(jobsOf(workflow()))) {
    for (const s of stepsOf(j)) {
      const expressions = runText(s).match(/\$\{\{[^}]*\}\}/g) ?? [];
      for (const e of expressions) {
        if (/github\.(event|head_ref)|secrets\./.test(e)) bad.push(`${id}: ${e}`);
      }
    }
  }
  assert.deepEqual(
    bad,
    [],
    `these expressions are pasted into a shell script before it runs; pass them through env instead: ${bad.join(', ')}`,
  );
});

test('fast-feedback: two Linux jobs, a cached pnpm store and cancelled superseded runs', () => {
  const wf = workflow();
  const verify = job('verify');
  const runsOn = String(verify['runs-on']);
  const oses = runsOn.includes('matrix.os') ? matrixValues(verify, 'os') : [runsOn];
  const nonLinux = oses.filter((o) => !/^ubuntu-/.test(o));
  assert.deepEqual(nonLinux, [], `production is Linux; drop these runners: ${nonLinux.join(', ')}`);
  assert.equal(oses.length, 1, `run verify on one Linux runner, found: ${oses.join(', ')}`);

  const setupNode = stepsOf(verify).find((s) => usesAction(s, 'actions/setup-node'));
  assert.ok(setupNode, 'the verify job must use actions/setup-node');
  const nodeSpec = String(setupNode.with?.['node-version'] ?? '');
  const nodes = nodeSpec.includes('matrix.') ? matrixValues(verify, nodeSpec.match(/matrix\.([\w-]+)/)[1]) : [nodeSpec];
  assert.deepEqual(
    [...new Set(nodes.map((n) => n.split('.')[0]))].sort(),
    ['24', '26'],
    `test on Node 24 (production) and 26 (next), nothing else; found: ${nodes.join(', ') || 'no node-version'}`,
  );

  const steps = stepsOf(verify);
  assert.ok(
    steps.some((s) => usesAction(s, 'pnpm/action-setup') || usesAction(s, 'pnpm/setup')),
    'install pnpm with pnpm/action-setup instead of npm install --global',
  );
  assert.ok(
    setupNode.with?.cache === 'pnpm' ||
      steps.some((s) => (usesAction(s, 'pnpm/action-setup') || usesAction(s, 'pnpm/setup')) && String(s.with?.cache) === 'true'),
    'the pnpm store is not cached, so every job downloads every package again',
  );

  const concurrency = wf.concurrency;
  assert.ok(concurrency && typeof concurrency === 'object', 'add a workflow-level concurrency group so a new push cancels the run it replaces');
  assert.match(String(concurrency.group ?? ''), /github\.(ref|head_ref)/, 'the concurrency group must include the branch (github.ref)');
  assert.equal(String(concurrency['cancel-in-progress']), 'true', 'set cancel-in-progress: true');
  for (const id of ['verify', 'image']) {
    const t = Number(job(id)['timeout-minutes']);
    assert.ok(t > 0 && t <= 30, `set timeout-minutes (30 or less) on the ${id} job, found: ${job(id)['timeout-minutes']}`);
  }
});

test('image-gated: the image is built only after verify passes on a push to main', () => {
  const image = job('image');
  assert.ok(asList(image.needs).includes('verify'), 'the image job must declare needs: verify, or it runs in parallel and can publish a broken build');
  const cond = String(image.if ?? '');
  assert.match(cond, /github\.ref\s*==\s*'refs\/heads\/main'/, `the image job must only run for main, e.g. if: github.ref == 'refs/heads/main'; found: ${cond || 'no if'}`);
  assert.match(cond, /github\.event_name\s*==\s*'push'/, "the image job must only run on push events (github.event_name == 'push')");
  assert.ok(!stepsOf(image).some((s) => /docker\s+login/.test(runText(s))), 'log in with docker/login-action instead of docker login in a run step');
  assert.ok(stepsOf(image).some((s) => usesAction(s, 'docker/login-action')), 'the image job must log in to ghcr.io with docker/login-action');
});

test('image-tags-cache: the image is tagged with the commit SHA and reuses the build cache', () => {
  const build = stepsOf(job('image')).find((s) => usesAction(s, 'docker/build-push-action'));
  assert.ok(build, 'the image job must use docker/build-push-action');
  const w = build.with ?? {};
  const tags = String(w.tags ?? '')
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  assert.ok(
    tags.some((t) => /:\$\{\{\s*github\.sha\s*\}\}$/.test(t)),
    `tag the image with the commit (…:\${{ github.sha }}) so every deploy names an exact build; found tags: ${tags.join(', ') || 'none'}`,
  );
  assert.ok(!tags.every((t) => /:latest$/.test(t)), 'a :latest tag alone cannot be rolled back to');
  assert.match(String(w['cache-from'] ?? ''), /type=gha/, 'set cache-from: type=gha so unchanged layers are not rebuilt');
  assert.match(String(w['cache-to'] ?? ''), /type=gha/, 'set cache-to: type=gha so this build fills the cache for the next one');
});
