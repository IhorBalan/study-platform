// Static checks for "Fix the manifests". They read k8s/*.yaml and never talk to a cluster.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parseAll } from './yaml.mjs';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const DRAIN_SECONDS = 20; // from the brief: the app needs up to 20 s to finish its requests

let cached;
function objects() {
  if (cached) return cached;
  const folder = path.join(dir, 'k8s');
  assert.ok(existsSync(folder), 'Keep the manifests in k8s/. The folder was not found.');
  const files = readdirSync(folder).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0, 'Expected .yaml files in k8s/, found none.');
  const out = [];
  for (const file of files.toSorted()) {
    let docs;
    try {
      docs = parseAll(readFileSync(path.join(folder, file), 'utf8'));
    } catch (error) {
      assert.fail(`k8s/${file} could not be read: ${error.message}`);
    }
    for (const doc of docs) {
      assert.ok(doc && typeof doc === 'object' && !Array.isArray(doc), `k8s/${file}: every document must be a mapping with apiVersion and kind`);
      assert.ok(doc.apiVersion && doc.kind, `k8s/${file}: a document has no apiVersion or kind`);
      out.push({ ...doc, file });
    }
  }
  cached = out;
  return out;
}

function one(kind) {
  const found = objects().filter((o) => o.kind === kind);
  assert.equal(found.length, 1, `Expected exactly one ${kind} in k8s/, found ${found.length}`);
  return found[0];
}

const deployment = () => one('Deployment');
const podSpec = () => deployment().spec?.template?.spec ?? {};
const podLabels = () => deployment().spec?.template?.metadata?.labels ?? {};
function containers() {
  const list = podSpec().containers;
  assert.ok(Array.isArray(list) && list.length > 0, 'The Deployment has no containers');
  return list;
}
const app = () => containers()[0];

/** True when every label of the selector is on the Pods. An empty selector matches nothing useful. */
function selects(selector) {
  const entries = Object.entries(selector ?? {});
  return entries.length > 0 && entries.every(([key, value]) => podLabels()[key] === value);
}
const show = (value) => JSON.stringify(value ?? null);

test('parses: the manifests are readable and hold one Deployment, Service, HorizontalPodAutoscaler and PodDisruptionBudget', () => {
  for (const kind of ['Deployment', 'Service', 'HorizontalPodAutoscaler', 'PodDisruptionBudget']) one(kind);
  assert.equal(deployment().apiVersion, 'apps/v1', 'A Deployment is apps/v1');
  assert.equal(one('HorizontalPodAutoscaler').apiVersion, 'autoscaling/v2', 'Use autoscaling/v2 for the HorizontalPodAutoscaler');
  assert.equal(one('PodDisruptionBudget').apiVersion, 'policy/v1', 'A PodDisruptionBudget is policy/v1');
  for (const o of objects()) assert.equal(o.metadata?.namespace, 'shop', `${o.kind} ${o.metadata?.name}: keep the namespace shop`);
});

test('selectors: the Deployment, the Service and the PodDisruptionBudget all select the Pods of the template', () => {
  const labels = show(podLabels());
  const d = deployment();
  assert.ok(selects(d.spec?.selector?.matchLabels), `The Deployment's selector ${show(d.spec?.selector?.matchLabels)} does not match its template labels ${labels}. The API server rejects that.`);
  const s = one('Service');
  assert.ok(selects(s.spec?.selector), `The Service's selector ${show(s.spec?.selector)} matches no Pod of the Deployment (labels ${labels}), so it has no endpoints.`);
  const p = one('PodDisruptionBudget');
  assert.ok(selects(p.spec?.selector?.matchLabels), `The PodDisruptionBudget's selector ${show(p.spec?.selector?.matchLabels)} does not match the Pods (labels ${labels}), so it protects nothing.`);
});

test('service-port: the Service sends traffic to a port the container listens on', () => {
  const ports = containers().flatMap((c) => c.ports ?? []);
  assert.ok(ports.some((p) => p.containerPort === 8080), 'The app listens on 8080: keep containerPort 8080');
  const servicePorts = one('Service').spec?.ports ?? [];
  assert.ok(servicePorts.length > 0, 'The Service has no ports');
  for (const sp of servicePorts) {
    const target = sp.targetPort ?? sp.port;
    const hit = ports.some((p) => p.containerPort === target || (typeof target === 'string' && p.name === target));
    assert.ok(hit, `The Service's targetPort ${show(target)} is neither a containerPort nor a port name of the container (${show(ports)})`);
  }
  assert.ok(servicePorts.some((sp) => sp.port === 80), 'Keep the Service on port 80: the route in front of it points there');
});

test('pinned-image: the image has an immutable tag or a digest, not latest', () => {
  for (const c of containers()) {
    const image = String(c.image ?? '');
    const name = image.split('/').at(-1);
    const digest = name.includes('@sha256:');
    const tag = name.includes(':') ? name.split(':').at(-1) : '';
    assert.ok(digest || tag !== '', `${c.name}: the image ${show(image)} has no tag, which means latest`);
    assert.ok(digest || tag !== 'latest', `${c.name}: the image tag is latest. Pin a version such as the commit SHA.`);
  }
});

test('resources: every container requests CPU and memory and has a memory limit', () => {
  for (const c of containers()) {
    const r = c.resources ?? {};
    assert.ok(r.requests?.cpu, `${c.name}: resources.requests.cpu is missing. The scheduler and the HPA's CPU percentage both need it.`);
    assert.ok(r.requests?.memory, `${c.name}: resources.requests.memory is missing`);
    assert.ok(r.limits?.memory, `${c.name}: resources.limits.memory is missing`);
  }
});

test('probes: readiness asks /readyz, and liveness does not depend on the database', () => {
  const c = app();
  assert.equal(c.readinessProbe?.httpGet?.path, '/readyz', `The app container needs a readinessProbe on /readyz. Found: ${show(c.readinessProbe?.httpGet)}`);
  for (const [name, probe] of [['livenessProbe', c.livenessProbe], ['startupProbe', c.startupProbe]]) {
    if (!probe) continue;
    assert.equal(probe.httpGet?.path, '/livez', `${name} must call /livez, which checks only the process. Found: ${show(probe.httpGet ?? probe)}`);
  }
  for (const probe of [c.readinessProbe, c.livenessProbe, c.startupProbe]) {
    if (!probe?.httpGet) continue;
    const port = probe.httpGet.port;
    const known = (c.ports ?? []).some((p) => p.containerPort === port || p.name === port);
    assert.ok(known, `A probe uses port ${show(port)}, which the container does not declare`);
  }
});

test('non-root: runAsNonRoot comes with a numeric non-zero runAsUser', () => {
  const pod = podSpec().securityContext ?? {};
  for (const c of containers()) {
    const own = c.securityContext ?? {};
    const nonRoot = own.runAsNonRoot ?? pod.runAsNonRoot;
    const user = own.runAsUser ?? pod.runAsUser;
    assert.equal(nonRoot, true, `${c.name}: keep runAsNonRoot: true`);
    assert.ok(Number.isInteger(user) && user > 0, `${c.name}: runAsNonRoot needs a numeric runAsUser above 0, because the image names its user (USER node). Found: ${show(user)}`);
    assert.notEqual(own.privileged, true, `${c.name}: privileged must not be true`);
  }
});

test('hpa-owns-replicas: the autoscaler targets the Deployment, and the Deployment sets no replicas', () => {
  const d = deployment();
  const h = one('HorizontalPodAutoscaler');
  assert.equal(h.spec?.scaleTargetRef?.kind, 'Deployment', 'The HPA must target the Deployment');
  assert.equal(h.spec?.scaleTargetRef?.name, d.metadata?.name, `The HPA targets ${show(h.spec?.scaleTargetRef?.name)}, and the Deployment is called ${show(d.metadata?.name)}`);
  assert.ok(Number.isInteger(h.spec?.minReplicas) && h.spec.minReplicas >= 2, `minReplicas must be at least 2. Found: ${show(h.spec?.minReplicas)}`);
  assert.ok(Number.isInteger(h.spec?.maxReplicas) && h.spec.maxReplicas > h.spec.minReplicas, 'maxReplicas must be above minReplicas');
  assert.equal(d.spec?.replicas, undefined, `The Deployment sets replicas: ${show(d.spec?.replicas)} while an HPA manages it. Every deploy would reset the count.`);
});

test('pdb-allows-eviction: the disruption budget leaves at least one Pod free to be evicted', () => {
  const spec = one('PodDisruptionBudget').spec ?? {};
  const min = one('HorizontalPodAutoscaler').spec?.minReplicas;
  const percent = (value) => (typeof value === 'string' && /^\d+%$/.test(value) ? Number(value.slice(0, -1)) : null);
  assert.ok((spec.minAvailable === undefined) !== (spec.maxUnavailable === undefined), 'A PodDisruptionBudget sets exactly one of minAvailable and maxUnavailable');
  if (spec.maxUnavailable !== undefined) {
    const p = percent(spec.maxUnavailable);
    const ok = p === null ? Number.isInteger(spec.maxUnavailable) && spec.maxUnavailable >= 1 : Math.ceil((p / 100) * min) >= 1;
    assert.ok(ok, `maxUnavailable ${show(spec.maxUnavailable)} allows no eviction, so node drains hang`);
    const most = p === null ? spec.maxUnavailable : Math.ceil((p / 100) * min);
    assert.ok(most < min, `maxUnavailable ${show(spec.maxUnavailable)} allows every one of the ${min} Pods to go at once`);
  } else {
    const p = percent(spec.minAvailable);
    const need = p === null ? spec.minAvailable : Math.ceil((p / 100) * min);
    assert.ok(Number.isInteger(need) && need >= 1, `minAvailable ${show(spec.minAvailable)} protects nothing`);
    assert.ok(need < min, `minAvailable ${show(spec.minAvailable)} with ${min} replicas at the minimum allows no eviction, so node drains hang`);
  }
});

test('graceful-shutdown: the grace period covers the preStop sleep and the time the app needs to drain', () => {
  const c = app();
  const preStop = c.lifecycle?.preStop ?? {};
  const fromExec = /\bsleep\s+(\d+)/.exec((preStop.exec?.command ?? []).join(' '))?.[1];
  const sleep = preStop.sleep?.seconds ?? (fromExec === undefined ? undefined : Number(fromExec));
  assert.ok(Number.isInteger(sleep) && sleep >= 5, `Keep a preStop sleep of at least 5 seconds so that endpoint removal spreads before SIGTERM. Found: ${show(preStop)}`);
  const grace = podSpec().terminationGracePeriodSeconds ?? 30;
  assert.ok(
    grace >= sleep + DRAIN_SECONDS,
    `terminationGracePeriodSeconds is ${grace}. The preStop sleep takes ${sleep} s of it and the app needs up to ${DRAIN_SECONDS} s to finish its requests, so it needs at least ${sleep + DRAIN_SECONDS}.`,
  );
  const strategy = deployment().spec?.strategy?.rollingUpdate ?? {};
  assert.ok(strategy.maxUnavailable === 0 || strategy.maxUnavailable === '0%', 'Keep maxUnavailable: 0 in the rolling update, so a deploy never drops below the current capacity');
});
