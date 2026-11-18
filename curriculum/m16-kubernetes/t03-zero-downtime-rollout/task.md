Explain what happens during a rolling update, why requests fail during this team's deploys, and how to make deploys zero-downtime. Write 500 to 900 words. Short YAML or TypeScript snippets are welcome where they make a fix precise.

## The setup

The `billing` API is a NestJS app on a current Kubernetes cluster, behind a Gateway API route.

- The Deployment has `replicas: 4` and **no `strategy` block**, so the defaults apply.
- It has a **readiness probe** on `/readyz`, which returns 200 once the app has called `listen()`. There is no startup probe. The liveness probe is on `/livez`.
- There is **no `preStop` hook** and **no `terminationGracePeriodSeconds`** set.
- The Dockerfile ends with `CMD ["npm", "run", "start:prod"]`. `main.ts` does not call `app.enableShutdownHooks()` and nothing listens for SIGTERM.
- Most requests take under 200 ms. `GET /invoices/export` streams a CSV and can take up to 50 seconds.
- Release 2.8 adds a new required `tax_region` column to the `invoices` table and code that reads it.

Customers report a burst of 502 errors and cut-off CSV downloads at every deploy.

## What to cover

1. **The rollout, step by step.** With 4 replicas and the default strategy, how many old and new Pods exist at each stage of the update from 2.7 to 2.8, and what decides when the controller moves on to the next step? Give the numbers the defaults produce.
2. **What happens to one old Pod** from the moment the controller decides to remove it until it is gone. Name every step and the default timing.
3. **Why the 502s and cut-off downloads happen.** Name each distinct cause in this setup and which step it belongs to.
4. **The fix.** List the changes to the manifest, the Dockerfile and the app code that make the rollout zero-downtime for normal requests. Give the values you would use and why. Say what you would do about the 50-second export.
5. **The `tax_region` column.** Old and new Pods run side by side during the rollout. In which order do you ship the schema change and the code so that neither version breaks? How many releases does it take?
6. **Proof.** How would you show, before and after the change, that deploys drop no requests?

## What is assessed

Whether the rollout numbers and termination sequence are correct, whether each cause of failure is matched to a concrete fix, and whether the migration plan keeps both versions working. There are no automated checks.
