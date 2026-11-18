---
title: Transactional email that arrives once and lands in the inbox
skills: [transactional-email]
---

Receipts, password resets, "your export is ready": transactional email is triggered by something a user did, and they are waiting for it. Sending one looks trivial, but three things go wrong in production. Messages land in spam because the domain is not authenticated. Messages are sent twice, or never, because sending happened inside a request that retried or failed. And addresses that bounce keep getting mail until your provider suspends you. This lesson covers how to choose a provider, how to authenticate your domain, and how to send from a job, exactly once per business event, tested locally with Mailpit.

## Transactional vs marketing

Keep the two apart, ideally on separate subdomains or provider streams:

- **Transactional**: one recipient, triggered by their action, expected. Receipts, resets, security alerts, invoices.
- **Marketing**: many recipients, sent by you, needs consent and an unsubscribe link.

Mailbox providers judge reputation per sending domain and IP. A newsletter that annoys people should not drag your password resets into spam. Use `mail.example.com` for transactional and `news.example.com` for marketing, or Postmark's separate message streams.

## Choosing how to send

You almost never run your own mail server. You hand messages to a provider, over one of two interfaces:

- **SMTP**: the standard protocol. Every provider supports it, and `nodemailer` speaks it. Switching providers means changing four environment variables.
- **HTTP API**: a JSON POST with the provider's SDK. Usually faster, with features like templates stored at the provider, tags, scheduled sends and idempotency headers.

| Provider | Strengths | Watch out for |
| --- | --- | --- |
| **Resend** | Developer-friendly API, React Email templates | Younger service; check limits for your volume |
| **Postmark** | Known for transactional deliverability, separate transactional and broadcast streams | Not meant for bulk marketing |
| **Amazon SES** | Very cheap at volume, fits an AWS stack | New accounts start in a sandbox that only sends to verified addresses; you build more yourself |

For a startup, start with SMTP through `nodemailer` behind your own small interface. You can move to a provider's API later without touching the callers.

```ts
import nodemailer from 'nodemailer';

export const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,                                   // STARTTLS is negotiated if the server offers it
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS! } : undefined,
});

const info = await transport.sendMail({
  from: 'Shop <orders@mail.example.com>',
  to: customer.email,
  subject: `Order ${order.id} confirmed`,
  text: renderText(order),
  html: renderHtml(order),
});
console.log(info.messageId);
```

## Templates

An email needs two bodies: **HTML** for most clients and **plain text** for the rest, for accessibility and for spam filters, which treat HTML-only mail as suspicious. Email HTML is its own dialect: tables for layout, inline styles, no external CSS, limited support for modern layout. Libraries help: React Email lets you write templates as React components (comfortable for a frontend developer), and MJML compiles a simple markup to robust email HTML.

Whatever you use, two rules:

- **Escape user data.** A customer named `<img src=x onerror=...>` must not inject markup into your email or into the admin's copy. JSX escapes by default; template strings do not.
- **Render from data you store**, not from the live request, so a retry renders the same email.

## SPF, DKIM and DMARC in plain words

Email was designed without sender authentication: anyone can write any `From:` address. Three DNS-based mechanisms fix that, and mailbox providers now require them:

- **SPF** (Sender Policy Framework): a DNS TXT record that lists which servers may send mail for your domain. "Mail from example.com only comes from these IPs or from my provider."
- **DKIM** (DomainKeys Identified Mail): your provider signs each message with a private key; the public key is in your DNS. A receiver verifies that the message was sent by someone holding your key and was not changed in transit. It is the same idea as a webhook signature, for email.
- **DMARC**: a DNS policy that ties both to the visible `From:` domain (**alignment**) and tells receivers what to do when checks fail (`p=none`, `quarantine` or `reject`), and where to send reports.

```text
example.com.                     TXT  "v=spf1 include:_spf.your-provider.example ~all"
s1._domainkey.mail.example.com.  CNAME s1.dkim.your-provider.example.
_dmarc.example.com.              TXT  "v=DMARC1; p=none; rua=mailto:dmarc@example.com"
```

Your provider gives you the exact records. Gmail's sender guidelines require SPF or DKIM, TLS and valid reverse DNS from every sender, and SPF, DKIM, an aligned DMARC record and one-click unsubscribe for marketing mail from bulk senders (more than 5,000 messages a day to Gmail). They also ask senders to keep the reported spam rate below 0.3%. Start DMARC at `p=none`, read the reports, then tighten it.

## Bounces and complaints

- A **hard bounce** means the address does not exist. Never send to it again.
- A **soft bounce** is temporary (full mailbox, server down). The provider retries.
- A **complaint** means the recipient clicked "report spam". Stop sending to them, at least anything optional.

Providers report these through their own webhooks (verify their signatures, exactly as in lesson 3). Store a **suppression list** and check it before sending. Providers suppress hard bounces on their side too, but your app should know, so it can ask the user to fix their address. Bounce and complaint rates are what get accounts suspended.

## Send from a job, once per business event

Sending inside an HTTP request or a database transaction has the dual-write problem from module 8. If the transaction rolls back after the email went out, the customer was told about an order that does not exist. If the process crashes after commit but before sending, the email never goes. So:

1. Commit the business change and an **outbox row** or job in the same transaction.
2. A worker sends the email, with retries and backoff for temporary SMTP errors (`4xx` replies, timeouts).
3. Make it **idempotent per business event**: one confirmation per order, whatever the number of retries, webhook duplicates or concurrent workers.

```sql
create table email_log (
  kind        text not null,                 -- 'order_confirmation'
  ref         text not null,                 -- the order id
  status      text not null check (status in ('sending', 'sent')),
  message_id  text,
  updated_at  timestamptz not null default now(),
  primary key (kind, ref)
);
```

Claim the row with `insert ... on conflict do nothing` before sending. If you win, send and mark it `sent`. If sending fails, delete the claim (or record the failure) so a retry can try again. If you lose the claim, someone else sent it or is sending it.

There is an unavoidable gap: if the SMTP server accepted the message and your process died before marking it `sent`, a retry sends a second copy. You cannot close that gap across two systems, only shrink it, with a lease on `sending` claims (module 8, lesson 3) or a provider idempotency key where the API offers one. For a receipt, a rare duplicate is acceptable; a missing one is not. Decide that consciously and write it down.

## Testing with Mailpit

Mailpit is a fake SMTP server with a web UI and a JSON API. Point your SMTP settings at it and every message is caught, nothing is delivered. In this course it runs with `pnpm lab up mailpit`: SMTP on `localhost:51025`, UI and API on `http://localhost:58025`.

```ts
const q = encodeURIComponent('to:"buyer@example.test"');
const res = await fetch(`http://localhost:58025/api/v1/search?query=${q}`);
const { messages } = await res.json();                 // summaries: ID, Subject, From, To, ...
const full = await (await fetch(`http://localhost:58025/api/v1/message/${messages[0].ID}`)).json();
console.log(full.Subject, full.Text, full.HTML);
await fetch(`http://localhost:58025/api/v1/search?query=${q}`, { method: 'DELETE' }); // clean up
```

Your integration tests can assert on subject, body and headers this way. For unit tests, nodemailer's `jsonTransport: true` returns the message as JSON without any server.

## Common mistakes

- Sending email inside a request or a transaction, so rollbacks and retries produce wrong or duplicate mail.
- No idempotency per business event, so a duplicated webhook sends two receipts.
- HTML-only messages, and user data in templates without escaping.
- A missing or unaligned DKIM and DMARC setup, discovered when customers say "I never got the reset link".
- Ignoring bounce and complaint webhooks until the provider suspends the account.
- Marketing and transactional mail on one domain and stream.

## Go deeper

- [Nodemailer](https://nodemailer.com/): SMTP transport options, testing transports and message fields.
- [Gmail: Email sender guidelines](https://support.google.com/mail/answer/81126): current authentication and spam-rate requirements.
- [RFC 9989: DMARC](https://www.rfc-editor.org/rfc/rfc9989): the policy and alignment rules (May 2026, replaces RFC 7489).
- [RFC 6376: DKIM](https://www.rfc-editor.org/rfc/rfc6376): how message signatures work.
- [Mailpit on GitHub](https://github.com/axllent/mailpit): the tool and its REST API for integration tests.
