---
title: Dashboards, SLOs and alerting
skills: [slo-alerting]
---

Collecting signals is half the job. The other half is deciding what "working" means, showing it on one screen, and waking someone only when users are actually hurting. This lesson covers SLIs, SLOs and error budgets in plain words, symptom-based alerts and burn rates, runbooks, and how a small team can be on call without burning out.

## SLIs, SLOs and error budgets

An **SLI** (service level indicator) is a measurement of user happiness, expressed as good events divided by all events:

- *Availability:* the share of `GET /orders` requests that did not return a 5xx.
- *Latency:* the share of `GET /orders` requests that completed in under 300 ms.

Be precise about what counts. Measured where (the load balancer sees failures your app never logs)? Which requests (do health checks count? 4xx?)? Over what window?

An **SLO** (service level objective) is a target for an SLI over a window: "99.5% of `GET /orders` requests complete in under 300 ms, over 30 days." It is an internal goal. An **SLA** is a contract with customers, with penalties, and should be looser than your SLO so you notice trouble before you owe money.

The **error budget** is what the SLO allows to go wrong: 100% minus the target. At 99.9% availability over 30 days, the budget is 0.1% of requests, or about 43 minutes of complete outage. The budget turns reliability into a decision tool. While budget remains, ship features and take risks. When it is spent, slow down and work on reliability. It also stops the pursuit of 100%, which no user can tell apart from 99.95% and which costs a fortune.

Pick targets from what users need and what you measure today, not from a wish. A new product often starts at 99.5% and tightens later. Three or four SLOs for the journeys that matter (sign in, browse, check out) beat thirty.

## Dashboards that answer questions

A useful service dashboard answers "are users OK, and if not, where?" in the first row:

1. **Rate, errors and duration** for the main routes (RED), with p50, p95 and p99 on the same panel.
2. **SLO status**: the SLI over the window and the budget remaining.
3. **Saturation**: event-loop lag, heap used, database pool in use and waiting, queue depth (USE).
4. **Dependencies**: latency and errors of the database and external APIs.
5. **Deploy markers**: a vertical line for every release. Half of all incidents start at one.

Keep it to one screen. Every panel should answer a question someone will ask during an incident. A panel nobody reads is noise that hides the one that matters.

## Alert on symptoms, not causes

There are two kinds of alerts. **Symptom** alerts fire when users are affected: errors are up, latency is up, the SLO budget is burning. **Cause** alerts fire on something that might lead to that: CPU at 90%, one pod restarted, a disk at 80%.

Page a human on symptoms. CPU at 90% while every request is fast is a busy server, not an incident. A database connection pool exhausted while users get errors will show up as a symptom anyway, and the cause appears on the dashboard you open. Cause alerts that predict a certain failure, such as "the disk will be full in four hours" or "the TLS certificate expires in seven days", are fine as tickets or chat messages during working hours.

Every page must be:

- **urgent**: it cannot wait until morning;
- **actionable**: there is something a human can do;
- **real**: it reflects user pain, not a test or a flapping check.

Alert fatigue is what happens otherwise. When most pages are noise, people learn to ignore them, and they ignore the real one too.

## Burn rate in brief

Alerting when the error rate is above the SLO's threshold for five minutes is too twitchy: a short blip pages someone over a dip that uses a sliver of the budget. Alerting on the budget remaining is too slow. The **burn rate** fixes both. It is how fast you spend the budget compared with spending it evenly over the window. A burn rate of 1 uses exactly the budget in 30 days. A burn rate of 14.4 uses 2% of a 30-day budget in one hour.

The Google SRE workbook suggests, for a 30-day window:

| Severity | Burn rate | Long window | Short window | Budget used when it fires |
| --- | --- | --- | --- | --- |
| Page | 14.4 | 1 hour | 5 minutes | 2% |
| Page | 6 | 6 hours | 30 minutes | 5% |
| Ticket | 1 | 3 days | 6 hours | 10% |

Both windows must be over the threshold. The long window proves the problem is significant. The short window proves it is still happening, so the alert resolves soon after a fix.

For a 99.9% availability SLO, the error-ratio threshold is `14.4 × 0.001 = 1.44%`:

```yaml
groups:
  - name: orders-slo
    rules:
      - alert: OrdersErrorBudgetFastBurn
        expr: |
          (
            sum(rate(http_requests_total{route="/orders",status_code=~"5.."}[1h]))
              / sum(rate(http_requests_total{route="/orders"}[1h]))
          ) > (14.4 * 0.001)
          and
          (
            sum(rate(http_requests_total{route="/orders",status_code=~"5.."}[5m]))
              / sum(rate(http_requests_total{route="/orders"}[5m]))
          ) > (14.4 * 0.001)
        labels:
          severity: page
        annotations:
          summary: "GET /orders is burning its error budget 14x too fast"
          runbook_url: "https://wiki.example.com/runbooks/orders-errors"
```

A latency SLO works the same way, with "bad" being requests above the threshold: total minus the bucket at `le="0.25"`. That is one more reason to put a bucket edge exactly at your SLO threshold.

With little traffic, ratios jump around: one failure in ten requests is 10%. At low volume, add a minimum request rate to the condition, or alert on absolute counts, or rely on a synthetic check that sends a request every minute.

## Runbooks

Every alert links to a **runbook**: a short page that says what the alert means, what users experience, the dashboard to open, the first three things to check, and how to mitigate (roll back, scale out, turn off a feature flag, fail over). Write it when you create the alert, while you still remember why. It does not need to be long. It needs to be usable by a tired person at 3 a.m. who did not write the code.

## On call for a small team

With four engineers you cannot staff a follow-the-sun rotation. Make the load fair and small:

- A **rotation** of a week each, with a clear hand-over, and a secondary who can be reached.
- **Few pages**: only symptom alerts on the SLOs for the critical journeys. Everything else goes to a channel read in working hours.
- **Review every page** at the weekly hand-over. Was it real? Was it actionable? Fix or delete the alert if not.
- **Mitigate first**. The on-call person's job is to stop the bleeding, usually with a rollback, not to find the root cause at night.
- **Blameless postmortems** for every user-visible incident: a timeline, the impact in numbers, what made it possible, and follow-ups with owners. The goal is to fix the system, not to find who typed the command.

Interviewers ask "tell me about an incident you handled" to hear exactly this: how you noticed, how you limited the impact, how you found the cause, and what you changed so it would not happen again. Prepare one story with numbers.

## Common mistakes

- An SLO with a vague SLI ("the API is up") that nobody can compute.
- Paging on CPU, memory or a single restart while users are fine.
- Alerting on a raw error rate over five minutes and getting paged for every blip.
- Alerts without runbooks, or runbooks nobody has opened since they were written.
- Aiming for 100%, which leaves no room to ship.
- Treating a postmortem as a hunt for the person who caused it.

## Go deeper

- [Google SRE book: Service level objectives](https://sre.google/sre-book/service-level-objectives/): SLIs, SLOs and SLAs.
- [Google SRE workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/): the derivation of multiwindow burn-rate alerts.
- [Prometheus: Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/): the rule file format.
- [Google SRE book: Postmortem culture](https://sre.google/sre-book/postmortem-culture/): writing blameless postmortems.
