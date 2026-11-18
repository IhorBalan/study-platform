// Checks for "Fan out order events with SNS and SQS". Node built-ins only; the AWS SDK comes
// from the submission's node_modules. Node runs src/order-events.ts directly by stripping its types.
// Every resource name starts with AWS_RESOURCE_PREFIX and is removed in after().
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const RUN_PREFIX = `${process.env.AWS_RESOURCE_PREFIX ?? 'check-local-'}t02-${randomUUID().slice(0, 6)}-`;
const requireFromSubmission = createRequire(path.join(dir, 'package.json'));
const CONSUMERS = ['analytics', 'email', 'fraud'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let snsSdk;
let sqsSdk;
let sns;
let sqs;

after(async () => {
  if (!sns) return;
  // Remove whatever the run created, whether or not the submission's destroy worked.
  const topics = [];
  let NextToken;
  do {
    const page = await sns.send(new snsSdk.ListTopicsCommand({ NextToken })).catch(() => ({}));
    topics.push(...(page.Topics ?? []).map((t) => t.TopicArn).filter((arn) => arn?.split(':').pop()?.startsWith(RUN_PREFIX)));
    NextToken = page.NextToken;
  } while (NextToken);
  for (const topicArn of topics) {
    const subs = await sns.send(new snsSdk.ListSubscriptionsByTopicCommand({ TopicArn: topicArn })).catch(() => ({}));
    for (const s of subs.Subscriptions ?? []) {
      if (s.SubscriptionArn?.startsWith('arn:')) await sns.send(new snsSdk.UnsubscribeCommand({ SubscriptionArn: s.SubscriptionArn })).catch(() => undefined);
    }
    await sns.send(new snsSdk.DeleteTopicCommand({ TopicArn: topicArn })).catch(() => undefined);
  }
  const listed = await sqs.send(new sqsSdk.ListQueuesCommand({ QueueNamePrefix: RUN_PREFIX })).catch(() => ({}));
  for (const url of listed.QueueUrls ?? []) await sqs.send(new sqsSdk.DeleteQueueCommand({ QueueUrl: url })).catch(() => undefined);
  sns.destroy();
  sqs.destroy();
});

let loaded;
async function load() {
  assert.ok(process.env.AWS_ENDPOINT_URL, 'AWS_ENDPOINT_URL is not set for the check run. Start the emulator with `pnpm lab up aws`.');
  const file = path.join(dir, 'src', 'order-events.ts');
  assert.ok(existsSync(file), 'src/order-events.ts is missing from the submission.');
  loaded ??= import(pathToFileURL(file).href);
  const mod = await loaded;
  for (const name of ['provisionOrderEvents', 'publishOrderEvent', 'destroyOrderEvents']) {
    assert.equal(typeof mod[name], 'function', `src/order-events.ts must export a function named ${name}.`);
  }
  if (!sns) {
    snsSdk = requireFromSubmission('@aws-sdk/client-sns');
    sqsSdk = requireFromSubmission('@aws-sdk/client-sqs');
    sns = new snsSdk.SNSClient({});
    sqs = new sqsSdk.SQSClient({ useQueueUrlAsEndpoint: false });
  }
  return mod;
}

/** One provisioned set of resources, shared by the tests that only read it. */
let shared;
async function provisioned() {
  const mod = await load();
  if (!shared) {
    const prefix = `${RUN_PREFIX}a-`;
    shared = { prefix, infra: await mod.provisionOrderEvents({ sns, sqs }, prefix) };
  }
  return { mod, ...shared };
}

async function drain(url, settleMs = 2500) {
  const bodies = [];
  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    const res = await sqs.send(new sqsSdk.ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }));
    for (const m of res.Messages ?? []) {
      bodies.push(m.Body);
      await sqs.send(new sqsSdk.DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: m.ReceiptHandle }));
    }
  }
  return bodies;
}

const asList = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc found errors:\n${output.slice(0, 3000)}`);
});

test('resources: one topic and three queues with the agreed names, returned by provisionOrderEvents', async () => {
  const { prefix, infra } = await provisioned();
  assert.equal(typeof infra?.topicArn, 'string', 'provisionOrderEvents should return { topicArn, queues }.');
  assert.ok(infra.topicArn.endsWith(`:${prefix}order-events`), `The topic should be named "<prefix>order-events". Got ${infra.topicArn}.`);
  for (const consumer of CONSUMERS) {
    const ref = infra.queues?.[consumer];
    assert.ok(ref?.url && ref?.arn, `queues.${consumer} should have a url and an arn.`);
    assert.ok(ref.arn.endsWith(`:${prefix}${consumer}`), `The ${consumer} queue should be named "<prefix>${consumer}". Got ${ref.arn}.`);
    const res = await sqs.send(new sqsSdk.GetQueueAttributesCommand({ QueueUrl: ref.url, AttributeNames: ['QueueArn'] }));
    assert.equal(res.Attributes?.QueueArn, ref.arn, `queues.${consumer}.arn does not match the queue at queues.${consumer}.url.`);
  }
  const subs = await sns.send(new snsSdk.ListSubscriptionsByTopicCommand({ TopicArn: infra.topicArn }));
  const endpoints = (subs.Subscriptions ?? []).filter((s) => s.Protocol === 'sqs').map((s) => s.Endpoint).sort();
  assert.deepEqual(endpoints, CONSUMERS.map((c) => infra.queues[c].arn).sort(), 'Each of the three queues should be subscribed to the topic once.');
});

test('queue-policy: each queue lets only this topic send to it', async () => {
  const { infra } = await provisioned();
  for (const consumer of CONSUMERS) {
    const { url, arn } = infra.queues[consumer];
    const res = await sqs.send(new sqsSdk.GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['Policy'] }));
    assert.ok(res.Attributes?.Policy, `The ${consumer} queue has no access policy. On real AWS, SNS cannot deliver to it.`);
    const policy = JSON.parse(res.Attributes.Policy);
    const statements = asList(policy.Statement);
    const ok = statements.some((s) => {
      if (s.Effect !== 'Allow') return false;
      const services = asList(s.Principal?.Service);
      if (!services.includes('sns.amazonaws.com')) return false;
      if (!asList(s.Action).includes('sqs:SendMessage')) return false;
      if (!asList(s.Resource).includes(arn)) return false;
      return Object.values(s.Condition ?? {}).some((block) =>
        Object.entries(block ?? {}).some(([key, value]) => key.toLowerCase() === 'aws:sourcearn' && asList(value).includes(infra.topicArn)),
      );
    });
    assert.ok(
      ok,
      `The ${consumer} queue policy needs an Allow statement for the service principal sns.amazonaws.com, the action sqs:SendMessage, the queue's ARN as Resource, and an aws:SourceArn condition naming the topic. Found: ${res.Attributes.Policy}`,
    );
  }
});

test('raw-delivery: consumers receive the published event as the message body, without the SNS envelope', async () => {
  const { mod, infra } = await provisioned();
  await drain(infra.queues.analytics.url, 300);
  const event = { type: 'order.placed', orderId: `raw-${randomUUID().slice(0, 6)}`, country: 'NL', totalCents: 1_999 };
  await mod.publishOrderEvent(sns, infra.topicArn, event);
  const bodies = await drain(infra.queues.analytics.url);
  assert.equal(bodies.length, 1, `The analytics queue should receive the event once, it received ${bodies.length} messages.`);
  let parsed;
  try {
    parsed = JSON.parse(bodies[0]);
  } catch {
    assert.fail(`The message body is not JSON: ${bodies[0].slice(0, 200)}`);
  }
  assert.ok(!('TopicArn' in parsed), 'The body is an SNS envelope. Turn on raw message delivery for the subscription.');
  assert.deepEqual(parsed, event, 'The body should be exactly the published event.');
});

test('routing: analytics gets every event, email paid and cancelled orders, fraud only paid orders from 100000 cents', async () => {
  const { mod, infra } = await provisioned();
  await Promise.all(CONSUMERS.map((c) => drain(infra.queues[c].url, 300)));
  const tag = randomUUID().slice(0, 6);
  const events = {
    placed: { type: 'order.placed', orderId: `${tag}-placed`, country: 'DE', totalCents: 500_000 },
    smallPaid: { type: 'order.paid', orderId: `${tag}-small`, country: 'DE', totalCents: 4_200 },
    edgePaid: { type: 'order.paid', orderId: `${tag}-edge`, country: 'US', totalCents: 100_000 },
    bigPaid: { type: 'order.paid', orderId: `${tag}-big`, country: 'FR', totalCents: 250_000 },
    cancelled: { type: 'order.cancelled', orderId: `${tag}-cancelled`, country: 'IT', totalCents: 300_000 },
  };
  for (const event of Object.values(events)) await mod.publishOrderEvent(sns, infra.topicArn, event);

  const received = {};
  const drained = await Promise.all(CONSUMERS.map((c) => drain(infra.queues[c].url, 3000)));
  for (const [i, c] of CONSUMERS.entries()) {
    received[c] = drained[i].map((b) => {
      try {
        return JSON.parse(b).orderId;
      } catch {
        return b;
      }
    }).sort();
  }
  const ids = (...keys) => keys.map((k) => events[k].orderId).sort();
  assert.deepEqual(received.analytics, ids('placed', 'smallPaid', 'edgePaid', 'bigPaid', 'cancelled'), 'analytics should receive every event exactly once.');
  assert.deepEqual(received.email, ids('smallPaid', 'edgePaid', 'bigPaid', 'cancelled'), 'email should receive order.paid and order.cancelled, and not order.placed.');
  assert.deepEqual(
    received.fraud,
    ids('edgePaid', 'bigPaid'),
    'fraud should receive only order.paid events with totalCents of at least 100000 (including exactly 100000).',
  );
});

test('idempotent-provision: running provisionOrderEvents again returns the same resources and adds no subscriptions', async () => {
  const { mod, prefix, infra } = await provisioned();
  const again = await mod.provisionOrderEvents({ sns, sqs }, prefix);
  assert.equal(again.topicArn, infra.topicArn, 'The second call should return the same topic.');
  for (const c of CONSUMERS) assert.equal(again.queues?.[c]?.arn, infra.queues[c].arn, `The second call should return the same ${c} queue.`);
  const subs = await sns.send(new snsSdk.ListSubscriptionsByTopicCommand({ TopicArn: infra.topicArn }));
  assert.equal((subs.Subscriptions ?? []).length, 3, `After two calls the topic should still have 3 subscriptions, it has ${(subs.Subscriptions ?? []).length}.`);
});

test('teardown: destroyOrderEvents removes the topic, its subscriptions and the queues', async () => {
  const mod = await load();
  const prefix = `${RUN_PREFIX}b-`;
  const infra = await mod.provisionOrderEvents({ sns, sqs }, prefix);
  await mod.destroyOrderEvents({ sns, sqs }, prefix);

  const queues = await sqs.send(new sqsSdk.ListQueuesCommand({ QueueNamePrefix: prefix }));
  assert.deepEqual(queues.QueueUrls ?? [], [], 'Queues with the prefix are still there after destroyOrderEvents.');
  const topics = await sns.send(new snsSdk.ListTopicsCommand({}));
  const left = (topics.Topics ?? []).map((t) => t.TopicArn).filter((arn) => arn === infra.topicArn);
  assert.deepEqual(left, [], 'The topic is still there after destroyOrderEvents.');
  const subs = await sns.send(new snsSdk.ListSubscriptionsCommand({}));
  const orphaned = (subs.Subscriptions ?? []).filter((s) => s.TopicArn === infra.topicArn);
  assert.equal(orphaned.length, 0, 'Subscriptions of the deleted topic are still listed.');

  await assert.doesNotReject(() => mod.destroyOrderEvents({ sns, sqs }, prefix), 'destroyOrderEvents should succeed when everything is already gone.');
  await sleep(10);
});
