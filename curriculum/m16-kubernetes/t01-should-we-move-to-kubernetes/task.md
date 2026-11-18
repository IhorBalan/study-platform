Advise a small startup on whether to move to Kubernetes. Write 500 to 900 words as a short decision memo for the founders. Use headings, lists or a table; no code is needed.

## The company

**Rota** sells shift scheduling to restaurants and clinics. Four engineers, no dedicated ops person.

Today everything runs on a PaaS (Render or similar):

- a NestJS API, 2 instances, about 150 requests per second at peak;
- a BullMQ worker, 1 instance, for reminders and payroll exports;
- managed PostgreSQL and managed Valkey from the same PaaS;
- deploys on merge to `main`, about 8 a day. The monthly bill is about $900.

A newly hired senior engineer proposes moving to Kubernetes on Amazon EKS this quarter. Their reasons:

1. "We will need to scale. Kubernetes is how serious companies scale."
2. "During deploys, a few requests fail with 502. Kubernetes does zero-downtime rolling updates."
3. "Payroll exports sometimes take 20 minutes and block the worker. With Kubernetes we can autoscale workers."
4. "A hospital group we are talking to may want Rota installed in their own AWS account next year. Kubernetes makes that portable."
5. "It will help us hire."

## What to cover

1. **Your recommendation** in one or two sentences at the top: move now, do not move, or a specific middle path.
2. **What Kubernetes would actually cost Rota.** List the concrete things the team would have to set up and keep running beyond "an EKS cluster", and estimate the ongoing engineering time in rough terms.
3. **Each of the five reasons.** For each, say whether Kubernetes is needed for it, and what Rota could do instead or first. For reason 2, name the likely cause of the 502s and a fix that works on the current platform.
4. **Reason 4 in more depth.** What would you need to know about the hospital deal before it changes the decision, and what is the cheapest way to keep that option open now?
5. **Signals to revisit.** Name at least three measurable conditions under which you would recommend Kubernetes (or another platform move) later.

## What is assessed

Whether the recommendation fits a four-person team, whether the cost list is concrete, whether each reason gets a specific answer rather than a general one, and whether the revisit signals are measurable. There are no automated checks.
