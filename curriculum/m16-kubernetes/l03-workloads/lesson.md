---
title: "Workloads: Pods, Deployments, Jobs and friends"
skills: [k8s-workloads]
---

A **workload** is something that runs your code. You almost never create the smallest unit, the Pod, by hand. You create a controller object, such as a Deployment or a CronJob, and it creates Pods for you from a template. This lesson covers the workload types a backend developer meets, with most attention on the Deployment, because that is where your API will live.

## Pods

A **Pod** is one or more containers that are scheduled together on one node and share a network namespace. Containers in a Pod reach each other on `localhost`, share the Pod's IP address and can share volumes.

Most Pods have one application container. Extra containers are for helpers that must live next to it:

- **Init containers** run to completion, one after another, before the app starts. Example: wait for a dependency, or render a config file.
- **Sidecar containers** run alongside the app for its whole life. Example: a log shipper or a service-mesh proxy. Kubernetes supports them natively as init containers with `restartPolicy: Always`, which start before the app and stop after it.

Pods are **disposable**. A Pod never moves to another node. If its node dies, or a deploy replaces it, the Pod is gone and a new one with a new name and IP takes its place. So never store anything you care about on a Pod's filesystem, and never address a Pod by IP. Treat Pods like cattle, not pets.

## Deployments and ReplicaSets

A **Deployment** runs a stateless app as N identical Pods and replaces them safely when you change the template. It does this through **ReplicaSets**:

- A ReplicaSet keeps exactly N Pods matching one Pod template running.
- A Deployment owns one ReplicaSet per version of the template. When you change the template (a new image tag, a new env var), it creates a new ReplicaSet and shifts Pods from the old one to the new one.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  labels:
    app: api
spec:
  replicas: 3
  revisionHistoryLimit: 5          # old ReplicaSets kept for rollback (default 10)
  selector:
    matchLabels:
      app: api                     # must match the template's labels
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1                  # at most 1 Pod above 3 during a rollout
      maxUnavailable: 0            # never fewer than 3 ready Pods
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: ghcr.io/acme/api:1.42.0
          ports:
            - containerPort: 3000
```

The `selector` is immutable after creation and must match `template.metadata.labels`. A mismatch is rejected by the API server.

### A rolling update, step by step

You change the image to `1.43.0` and apply. With `maxSurge: 1` and `maxUnavailable: 0`:

1. The Deployment controller creates ReplicaSet B for the new template, with 0 replicas. ReplicaSet A still has 3.
2. It scales B to 1. Total Pods: 4, which is the surge limit.
3. The new Pod starts. Until its **readiness probe** passes (lesson 6), it receives no traffic and does not count as available.
4. When it is ready, the controller scales A down to 2. The old Pod is removed from the Service's endpoints and asked to shut down.
5. It repeats until B has 3 ready Pods and A has 0. A is kept, scaled to zero, for rollback.

If a new Pod never becomes ready, the rollout stalls with the old Pods still serving, because `maxUnavailable: 0` forbids removing them. After `progressDeadlineSeconds` (default 600) the Deployment reports the rollout as failed. It does **not** roll back on its own; your pipeline or you must.

The defaults are `maxSurge: 25%` and `maxUnavailable: 25%`, which may remove a ready Pod before its replacement is ready. For a small API with three replicas, `maxSurge: 1, maxUnavailable: 0` is the safer choice.

The other strategy, `Recreate`, kills all old Pods before starting new ones. Use it only when two versions must never run at once, and accept downtime.

### Watching and rolling back

```sh
kubectl rollout status deploy/api --timeout=5m   # waits; non-zero exit on failure
kubectl rollout history deploy/api
kubectl rollout undo deploy/api                  # back to the previous ReplicaSet
kubectl rollout undo deploy/api --to-revision=7
kubectl rollout restart deploy/api               # new Pods, same spec (e.g. to reload a Secret)
```

`rollout undo` is fast because the old ReplicaSet still exists. But it changes the live object only. If your manifests in git still say `1.43.0`, the next deploy brings the broken version back. Revert in git too.

Rolling updates also mean **two versions run at the same time** for a while. Database migrations and API changes must be backwards compatible across one version (expand, then contract), as module 14 explains.

## Jobs and CronJobs

A **Job** runs Pods until a given number finish successfully. Use it for one-off work: a database migration before a release, a backfill, a report.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate-1-43-0
spec:
  backoffLimit: 2                  # retries before the Job is marked failed
  activeDeadlineSeconds: 600       # give up after 10 minutes
  ttlSecondsAfterFinished: 86400   # clean up the finished Job after a day
  template:
    spec:
      restartPolicy: Never         # Jobs need Never or OnFailure
      containers:
        - name: migrate
          image: ghcr.io/acme/api:1.43.0
          command: ["node", "dist/migrate.js"]
```

A **CronJob** creates a Job on a schedule:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-cleanup
spec:
  schedule: "15 3 * * *"
  timeZone: "Europe/London"
  concurrencyPolicy: Forbid        # skip a run if the previous one is still going
  jobTemplate:
    spec:
      backoffLimit: 1
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: cleanup
              image: ghcr.io/acme/api:1.43.0
              command: ["node", "dist/jobs/cleanup.js"]
```

Write job code to be **idempotent**. A Job can run a Pod more than once (a retry, a node failure), and a CronJob can occasionally miss or double a run.

## StatefulSets and DaemonSets, briefly

- A **StatefulSet** gives each Pod a stable name (`db-0`, `db-1`), a stable DNS name and its own persistent volume that follows it. It starts and stops Pods in order. It exists for databases, Kafka and similar clustered systems. For a small team, the better answer is usually a managed database outside the cluster. Running PostgreSQL in Kubernetes well means owning backups, failover and upgrades, typically through an operator.
- A **DaemonSet** runs one Pod on every node (or a chosen set of nodes). It is for node-level agents: log collectors, metrics exporters, network plugins. You rarely write one; add-ons ship them.

## Common mistakes

- Creating bare Pods. Nothing recreates them when they die.
- Leaving the default `maxUnavailable: 25%` on a small Deployment and dropping capacity during each deploy.
- Running `kubectl rollout undo` and not reverting git, so the next deploy re-breaks production.
- Database migrations in the app's start-up code, run by every replica at once. Use a Job or a pipeline step.
- Non-idempotent Jobs that charge a card twice on a retry.
- Running your main database as a StatefulSet without the skills to operate it.

## Go deeper

- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/): rolling updates, rollback and every strategy field.
- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/): lifecycle, init containers and sidecars.
- [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/): completions, retries, deadlines and cleanup.
- [CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/): schedules, time zones and concurrency policies.
- [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/): what stable identity and storage guarantee.
