---
title: The most-asked backend questions
skills: [interview-core-questions]
---

A handful of questions come up in loop after loop, across companies and across rounds: the event loop, isolation levels, pagination, rate limiting, webhooks, a latency spike after a deploy. The core modules teach each of them in depth. This short lesson is about answering them under interview conditions, and its deck collects the most-asked ones as a warm-up you can run the morning of an interview. A few of its cards repeat facts from earlier decks on purpose, phrased the way an interviewer asks them.

## The shape of a good short answer

A deep-dive question is an invitation, not an exam. A strong answer has three layers, and you deliver them one at a time:

1. **The headline,** in one or two sentences. What it is and why it exists.
2. **The mechanism,** in three or four sentences, with one concrete detail that shows you have used it: a function name, a config value, a failure you saw.
3. **The trade-off or failure mode,** in one sentence. When it hurts, or what people get wrong.

Then stop and let the interviewer pick where to go deeper. Talking for five minutes straight on the event loop does not show more depth. It shows you did not notice they wanted to move on.

An example, for "How do you detect a blocked event loop in production?":

> **Headline.** I measure event-loop delay and alert on it, because a blocked loop shows up as every request slowing at once rather than one slow endpoint.
>
> **Mechanism.** Node's `perf_hooks.monitorEventLoopDelay()` gives a histogram of delays. I export its p99 as a metric next to request latency. When it spikes, I take a CPU profile with `--cpu-prof` or the inspector, and look for a synchronous hot spot: a big `JSON.parse`, a sync crypto call, a regex with catastrophic backtracking.
>
> **Trade-off.** The fix is usually to move the work off the main thread with `worker_threads` or a job queue, which adds serialisation cost and complexity, so I only do it for work that is measurably blocking.

That is about 45 seconds. Every sentence is checkable, and each one opens a door the interviewer can walk through.

## Scenario questions

Some of the most-asked questions are scenarios: "p99 latency spiked after a deploy. What do you do?" These score your method more than your knowledge. A method that works for nearly all of them:

1. **Stabilise.** If users are hurting and a deploy is the likely cause, roll back first, investigate second.
2. **Scope.** Which endpoints, which instances, since when? Compare the timeline with deploys, config changes and traffic.
3. **Measure.** Look at the metrics and traces for where the time goes: the database, a downstream call, the event loop, garbage collection.
4. **Hypothesise and verify.** One cause at a time, confirmed with data, not guessed.
5. **Fix and prevent.** The fix, plus the alert, test or check that would have caught it earlier.

Say the steps out loud even when you think you know the answer. The interviewer is scoring the method.

## Where the rest lives

The decks of earlier modules already ask many of the high-frequency questions with an "Interview:" prefix: sessions vs JWTs, SQL injection, XSS and CSRF, caching and stampedes, lost updates, the outbox pattern, Kubernetes probes, Kafka delivery guarantees. Run those decks too. This lesson's deck is a mixed review of the most-asked questions that cut across modules:

| Topic | Taught in |
| --- | --- |
| Event loop phases, `nextTick` and microtasks, blocked loops, CPU-bound work, memory leaks | Module 0 and module 12 |
| Dependency injection in NestJS | Module 2 |
| Isolation levels, reading query plans | Module 3 |
| Cursor pagination | Module 4 |
| Rate limiting across instances | Module 7 |
| Stripe webhooks | Module 10 |
| A latency spike after a deploy | Module 12 |

If a card here feels shaky, go back to the lesson that teaches it rather than memorising the back of the card. Interviewers ask "why" twice, and a memorised answer runs out after the first.

## Common mistakes

- Answering a "what is" question with a five-minute lecture.
- Giving a definition with no concrete detail, which sounds learned from a list.
- Jumping to a root cause in a scenario question without stabilising or measuring.
- Memorising card backs instead of understanding the mechanism behind them.
- Saying "it depends" without saying on what.

## Go deeper

- [Node.js: the event loop, timers and process.nextTick()](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick): the phases and the queues in the official guide.
- [Node.js: perf_hooks](https://nodejs.org/api/perf_hooks.html): `monitorEventLoopDelay` and `eventLoopUtilization`.
- [PostgreSQL: transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html): which anomalies each level prevents in Postgres.
- [Stripe: webhooks](https://docs.stripe.com/webhooks): signature verification, retries and handling duplicate events.
