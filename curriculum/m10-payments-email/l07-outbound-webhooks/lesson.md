---
title: "Outbound webhooks: building your own"
skills: [outbound-webhooks, webhook-handling]
---

So far you have received webhooks. Sooner or later your own customers will ask for them: "call our URL when an invoice is paid". Now you are Stripe, and every guarantee you relied on in lesson 3 is yours to provide: signatures, retries, a delivery log, secret rotation. There is also a new danger. Your server will make HTTP requests to URLs that strangers type in, which is a textbook way to get attacked. This lesson designs a small, trustworthy webhook system.

## The model

Four tables cover it:

```sql
create table webhook_endpoints (
  id           text primary key,
  account_id   text not null,
  url          text not null,
  event_types  text[] not null,              -- what the customer subscribed to
  secrets      text[] not null,              -- current secret first; more than one during rotation
  disabled_at  timestamptz
);

create table webhook_events (                -- what happened, written in the business transaction
  id          text primary key,              -- msg_... stable across retries
  account_id  text not null,
  type        text not null,                 -- invoice.paid
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

create table webhook_deliveries (            -- one row per event per endpoint
  id              bigint generated always as identity primary key,
  event_id        text not null references webhook_events (id),
  endpoint_id     text not null references webhook_endpoints (id),
  status          text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  attempts        int  not null default 0,
  next_attempt_at timestamptz not null default now(),
  unique (event_id, endpoint_id)
);

create table webhook_attempts (              -- the delivery log customers see
  delivery_id     bigint not null references webhook_deliveries (id),
  attempted_at    timestamptz not null default now(),
  response_status int,
  error           text,
  duration_ms     int not null
);
```

`webhook_events` is an outbox (module 8): write it in the same transaction as the business change, so an event exists if and only if the change committed. A fan-out step creates one delivery per subscribed endpoint, and workers send deliveries whose `next_attempt_at` has passed, claimed with `for update skip locked` so several workers can share the load.

## The payload

A consistent envelope makes life easy for your customers:

```json
{
  "type": "invoice.paid",
  "timestamp": "2026-11-18T09:12:44Z",
  "data": { "invoiceId": "inv_42", "amountMinor": 4900, "currency": "eur" }
}
```

Decide between **full** payloads (the object as it was) and **thin** payloads (ids only; the receiver calls your API for current data). Thin payloads leak less data to a misconfigured URL and are never stale, at the cost of an API call. Stripe now offers both, for the same reasons. Keep payloads small either way, and version them like any public API (module 4): adding fields is fine, removing or renaming is a breaking change.

## Signing: HMAC with a timestamp

Give each endpoint a random secret and sign every request, exactly as Stripe does, so receivers can check authenticity, integrity and freshness. The **Standard Webhooks** specification, written by several webhook providers, defines one common format. Using it means your customers can verify with existing libraries:

- `webhook-id`: the event id, stable across retries. Receivers use it to deduplicate.
- `webhook-timestamp`: Unix seconds of this attempt.
- `webhook-signature`: `v1,` followed by the base64 HMAC-SHA256 of `` `${id}.${timestamp}.${body}` ``. Several signatures, separated by spaces, are allowed.

```ts
import { createHmac, randomBytes } from 'node:crypto';

export const newSecret = () => `whsec_${randomBytes(32).toString('base64')}`;

export function signatureHeaders(id: string, body: string, secrets: string[], now = Date.now()) {
  const timestamp = Math.floor(now / 1000).toString();
  const signatures = secrets.map((secret) => {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const mac = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
    return `v1,${mac}`;
  });
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': signatures.join(' '),
  };
}
```

Sign the exact string you send (`body` is the already-serialised JSON) and document that receivers must verify the raw bytes, the lesson 3 problem from the other side. Including the timestamp in the signed content lets receivers reject old messages; including the id ties the signature to one event.

### Secret rotation

Customers must be able to rotate a secret without dropping events. Store a list: when a customer rolls their secret, put the new one first and keep the old one for a grace period (Stripe allows up to 7 days). During that time you send one signature per secret; the receiver accepts the request if any matches. After the grace period, remove the old secret. Show secrets once, store them encrypted, and let customers roll them from your UI.

## Delivery, retries and backoff

Treat only a `2xx` response as success. Everything else (timeouts, connection errors, `3xx`, `4xx`, `5xx`) is a failure to retry, with two refinements: do not follow redirects (ask the customer to fix the URL), and treat `410 Gone` as "disable this endpoint".

```ts
const RETRY_DELAYS_S = [5, 300, 1800, 7200, 18000, 36000, 36000]; // about 27 hours in total

async function attempt(delivery: Delivery, endpoint: Endpoint, event: StoredEvent) {
  const body = JSON.stringify({ type: event.type, timestamp: event.createdAt.toISOString(), data: event.payload });
  const started = performance.now();
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await postWithSsrfGuard(endpoint.url, body, signatureHeaders(event.id, body, endpoint.secrets), 15_000);
    status = res.status;
  } catch (e) {
    error = String((e as Error).message).slice(0, 500);
  }
  await logAttempt(delivery.id, status, error, Math.round(performance.now() - started));

  if (status !== null && status >= 200 && status < 300) return markSucceeded(delivery.id);
  if (status === 410) return disableEndpoint(endpoint.id, 'receiver returned 410');
  const delay = RETRY_DELAYS_S[delivery.attempts];
  if (delay === undefined) return markFailed(delivery.id);              // give up; visible in the log
  const jittered = delay * (0.8 + Math.random() * 0.4);
  return scheduleRetry(delivery.id, jittered);                         // next_attempt_at = now() + jittered
}
```

Points from module 8 apply directly: exponential backoff with jitter so a recovering receiver is not hit by a synchronised wave, a timeout on every request (15 to 30 seconds is common), and a final "failed" state instead of retrying forever. If an endpoint fails everything for days, disable it and email the account owner. Delivery is at least once, so tell receivers to deduplicate on `webhook-id`, and do not promise ordering.

## The delivery log

Customers will ask "did you send it?". A page listing each event, each attempt, the response status and the duration answers that without a support ticket. Add a **Resend** button that creates a new attempt for the same event (same `webhook-id`, so the receiver can still deduplicate). Do not log full response bodies from customer servers; a status code and a truncated error are enough.

## SSRF: the URL is attacker-controlled

Server-side request forgery (module 6) is the main security risk. A "customer" registers `http://169.254.169.254/latest/meta-data/` (the cloud metadata service), `http://localhost:6379` or `http://10.0.3.7/admin`, and your worker happily sends requests inside your network, maybe returning the response in the delivery log.

Defences, layered:

- **Validate on registration**: `https:` only in production, no credentials in the URL, no raw IP literals if you can.
- **Check the resolved IP at connect time**, not just the hostname at registration. A hostname can resolve to a public IP when saved and to `127.0.0.1` later (DNS rebinding). In Node, pass a `lookup` function to `http.request` so the check runs on the address actually used:

```ts
import dns from 'node:dns';
import { BlockList, type LookupFunction } from 'node:net';

const blocked = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10]] as const) blocked.addSubnet(net, prefix, 'ipv6');

export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const bad = addresses.find((a) => blocked.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'));
    if (bad) return callback(new Error(`refusing to connect to ${bad.address}`), '', 4);
    if ((options as { all?: boolean }).all) return (callback as Function)(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};
// https.request(url, { method: 'POST', lookup: safeLookup, timeout: 15_000 }, ...)
```

`BlockList` also matches IPv4-mapped IPv6 addresses such as `::ffff:127.0.0.1` against the IPv4 rules.

- **Do not follow redirects**, which would bypass both checks.
- **Isolate the workers**: run them in a subnet with no route to internal services, or send through an egress proxy that enforces the same rules. The Standard Webhooks specification recommends exactly that.
- **Limit what you read back**: a capped response size and a short timeout, so a receiver cannot tie up your workers.

## Build or buy

The parts above are a few hundred lines plus a UI, and then years of edge cases: slow receivers, endpoint health, replay tools, per-customer rate limits. Hosted services such as Svix and Hookdeck sell exactly this as a service. For a small team, build the outbox and signing yourself, and consider a service when customers start asking for a delivery dashboard and replay tools.

## Common mistakes

- Sending webhooks from the request handler, before or without committing the business change.
- No signature, or a signature without a timestamp, so captured requests can be replayed.
- Generating a new event id per attempt, so receivers cannot deduplicate.
- Checking the URL's hostname once at registration and trusting it forever.
- Following redirects, or returning the receiver's response body in your UI.
- Retrying forever without jitter, or never disabling an endpoint that has been dead for a week.

## Go deeper

- [Standard Webhooks specification](https://www.standardwebhooks.com/): headers, signature format, retries and security advice.
- [OWASP: Server-Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): allow-lists, DNS rebinding and network controls.
- [Node.js net.BlockList](https://nodejs.org/api/net.html#class-netblocklist): matching addresses against blocked ranges.
- [Node.js http.request options](https://nodejs.org/api/http.html#httprequestoptions-callback): the `lookup` and `timeout` options used above.
- [Stripe: Receive events](https://docs.stripe.com/webhooks): a mature provider's retry and signing behaviour to compare with yours.
