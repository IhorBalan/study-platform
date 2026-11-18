---
title: System design in 45 minutes
skills: [interview-system-design]
---

A startup system design round is not a quiz on distributed systems. It checks whether you can turn a vague product idea into a design that a small team can build this quarter and still run next year. This lesson gives you a repeatable six-step method with a time budget, then walks through one prompt end to end.

## What the interviewer wants to see

The prompt is deliberately vague: "Design a URL shortener." The interviewer watches how you reduce ambiguity, whether your design matches the numbers, and whether you can say what breaks first. A big-tech answer with sharding, a global CDN and three queues is a wrong answer here. Start with one service and Postgres, and add a piece only when a requirement or a number forces it.

Think of it like building a React feature. You would not add Redux, a service worker and micro-frontends before the first screen works. You would build the simple version, measure, and add what the problem demands.

## The method and the clock

| Step | Minutes | Output on the board |
| --- | --- | --- |
| 1. Requirements | 5 | Functional list, non-functional list, explicit "out of scope" |
| 2. Numbers | 5 | Users, requests per second (average and peak), storage per year, read to write ratio |
| 3. API | 5 | Four to six endpoints with methods, inputs and status codes |
| 4. Data model | 5 | Tables, keys, the indexes the API needs |
| 5. Simple design | 10 | One box diagram that satisfies every requirement at today's numbers |
| 6. Failure and scaling | 10 | What fails, how you notice, what changes at 10x |
| Wrap-up | 5 | Trade-offs you made, what you would build next |

Say the plan out loud at the start: "I'll spend five minutes on requirements, then do some quick numbers, then API and data model, then the design, and leave time for failures and scaling." It shows structure and lets the interviewer redirect you early.

### 1. Requirements

Ask, do not assume. Split them in two:

- **Functional:** what users can do. Keep it to three to five items.
- **Non-functional:** latency, availability, consistency, retention, security. These drive the architecture more than the features do.

Write an "out of scope" line too. Saying "no analytics dashboard in v1" is a design decision, and interviewers like seeing it made explicitly.

### 2. Numbers

Back-of-the-envelope maths takes two minutes and decides most of the design. Round hard. A day has about 86,400 seconds; call it 100,000. Peak traffic is often 5 to 10 times the average. A single Postgres instance on modest hardware comfortably handles thousands of simple indexed reads per second, and a single Node process handles hundreds to a few thousand light requests per second. If your numbers fall below those, you do not need a distributed system.

### 3. API

Write the endpoints as you would in an OpenAPI file: method, path, body, success status, the main error statuses. This is where your frontend experience shows. You know what a client needs.

### 4. Data model

Tables with primary keys, foreign keys, unique constraints and the indexes each query needs. Name the access patterns: "look up by code" means a unique index on `code`.

### 5. The simple design first

Draw the smallest thing that works: client, load balancer, a stateless API (two instances for availability), Postgres with a replica or backups. Add a cache, a queue or a worker only when you can point to a number or a requirement that needs it.

### 6. Failure and scaling

Go through each box and ask: what if it is slow, down, or wrong? Then answer the standard follow-ups before they are asked: what breaks first at 10x, where would a cache go and how is it invalidated, what happens if a worker crashes halfway, how do you deploy a schema change.

## Worked example: a URL shortener

**Requirements.** Users create a short link for a long URL, optionally with a custom alias. Anyone opening the short link is redirected. The owner sees a click count. Non-functional: redirects are fast (p99 under 50 ms server-side) and highly available; creating links can be a little slower. Links never change target once created. Out of scope for v1: detailed analytics, link expiry, editing.

**Numbers.** Say 10,000 users now and 100,000 next year, creating 1 million links a month at the higher number. That is about 0.4 writes per second on average, maybe 4 at peak. Reads outnumber writes by about 100 to 1, so 40 reads per second average and 400 at peak. A row is around 500 bytes, so 12 million links a year is about 6 GB. Conclusion out loud: "This fits on one Postgres instance with room to spare. The interesting parts are redirect latency, abuse, and unique codes, not raw scale."

**API.**

```http
POST /links          { "url": "https://...", "alias"?: "launch" }
  201 { "code": "aZ3kQ9x", "shortUrl": "https://sho.rt/aZ3kQ9x" }
  400 invalid URL or alias   409 alias taken   429 too many links
GET  /{code}         302 Location: <url>      404 unknown code
GET  /links/{code}/stats  200 { "clicks": 1234, "createdAt": "..." }
```

**Data model.**

```sql
CREATE TABLE links (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  url         text NOT NULL,
  owner_id    bigint REFERENCES users (id),
  clicks      bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

The `UNIQUE` constraint on `code` is the real collision guard. Generate a random 7-character base62 code (62^7 is about 3.5 trillion values), insert it, and retry with a new code on a unique violation. A counter encoded in base62 also works, but makes codes guessable, which leaks how many links exist.

**Simple design.** Two stateless Node instances behind a load balancer, one Postgres primary with automated backups. Redirects are a single indexed lookup. Creating a link validates the URL (only `http` and `https`, a length limit), checks a per-user rate limit, and inserts.

**302 or 301?** A 301 is cached by browsers, so repeat clicks never reach you and click counts undercount. A 302 costs a request each time but keeps counts honest. Say which you picked and why.

**Failure and scaling.**

- *Click counting under load.* Incrementing `clicks` on every redirect makes the hottest links into row-lock hot spots. Fix when needed: count in memory or in Valkey and flush every few seconds, or write click events to a table and aggregate later. Accept that a crash loses a few seconds of counts.
- *Database down.* Redirects fail. A read replica plus a small in-process LRU cache of hot codes keeps most redirects working. Codes never change target, so cache invalidation is trivial: none is needed.
- *Abuse.* Phishing links get you blocklisted. Rate limit creation per user and per IP, check URLs against a blocklist, and allow takedowns.
- *At 10x.* Reads grow first. Add the cache, then a read replica. Writes at 40 per second are still nothing for Postgres.

**Wrap-up.** "I chose one Postgres and random codes with a unique constraint, accepting a retry on rare collisions. The first thing I would add is a cache for hot redirects. I would not shard or add a queue until the numbers say so."

## Common mistakes

- Drawing boxes before asking a single question.
- Skipping the numbers, then designing for a scale nobody mentioned.
- Adding Kafka, microservices or Kubernetes without a requirement that needs them.
- Leaving no time for failure modes, which is often where most of the points are.
- Naming a technology without its trade-off. "Redis" is not an answer; "Valkey for the counter, accepting a few seconds of loss on crash" is.
- Going silent while thinking. Narrate, even when unsure.

## Go deeper

- [The System Design Primer](https://github.com/donnemartin/system-design-primer): broad reference for the building blocks, with worked examples.
- [Tech Interview Handbook: system design](https://techinterviewhandbook.org/system-design/): how the round is run and scored.
- [PostgreSQL: unique constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS): the guard behind collision-safe codes.
- [MDN: HTTP redirections](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Redirections): permanent vs temporary redirects and how browsers cache them.
