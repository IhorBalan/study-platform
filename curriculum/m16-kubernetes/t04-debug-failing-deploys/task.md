You are on call for a team that runs its Node APIs on Kubernetes. Diagnose four incidents from the evidence below and write up what you would check, what you conclude and how you would fix it. Write 600 to 1,000 words. Commands and short YAML are welcome.

## Part 1: your method

For each Pod state below, give the first commands you run and the two or three most likely causes: **`Pending`**, **`ImagePullBackOff`**, **`CrashLoopBackOff`**, and **`Running` but `0/1` ready**.

## Part 2: four incidents

**A. A deploy that never finishes.** The `api` Deployment uses `maxSurge: 1` and `maxUnavailable: 0`. Release 2.9 was applied 4 minutes ago.

```text
$ kubectl -n shop get pods
NAME                   READY   STATUS             RESTARTS      AGE
api-6d8f7b9c4-2kq9x    1/1     Running            0             3d
api-6d8f7b9c4-7wz5m    1/1     Running            0             3d
api-6d8f7b9c4-p4n8d    1/1     Running            0             3d
api-85c4d6f7b8-xm2rt   0/1     CrashLoopBackOff   5 (40s ago)   4m

$ kubectl -n shop logs api-85c4d6f7b8-xm2rt --previous
{"level":"fatal","msg":"Invalid environment","issues":[{"path":["REDIS_URL"],"message":"Invalid input: expected string, received undefined"}]}
```

**B. Restarts at peak time.** No deploy today, but at lunchtime peak:

```text
$ kubectl -n shop get pods -l app.kubernetes.io/name=api
NAME                  READY   STATUS    RESTARTS       AGE
api-7f9b8c6d5-4hj2k   1/1     Running   7 (2m ago)     6h
api-7f9b8c6d5-9xv3b   1/1     Running   5 (9m ago)     6h

$ kubectl -n shop describe pod api-7f9b8c6d5-4hj2k
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
    Limits:
      memory:  256Mi
    Requests:
      cpu:     100m
      memory:  256Mi
```

**C. A short database failover, a long outage.** Last night the managed PostgreSQL failed over, which took about 40 seconds. The API was down for six minutes. Events from that time, repeated for every `api` Pod:

```text
Warning  Unhealthy  Liveness probe failed: Get "http://10.0.2.14:3000/health": context deadline exceeded
Normal   Killing    Container api failed liveness probe, will be restarted
Warning  BackOff    Back-off restarting failed container api
```

Both the liveness and readiness probes call `/health`, which runs `SELECT 1` with a 5-second timeout.

**D. A new service returns 503.** The new `search` service's Pods show `1/1 Running`. Requests through the gateway get `503 no healthy upstream`.

```text
$ kubectl -n shop get endpointslices -l kubernetes.io/service-name=search
NAME           ADDRESSTYPE   PORTS     ENDPOINTS   AGE
search-8xk2p   IPv4          <unset>   <unset>     20m

$ kubectl -n shop get svc search -o jsonpath='{.spec.selector}'
{"app":"search"}

$ kubectl -n shop get pods -l app.kubernetes.io/name=search --show-labels
NAME                      READY   STATUS    LABELS
search-5b7c9d8f6-q2w4e    1/1     Running   app.kubernetes.io/name=search,pod-template-hash=5b7c9d8f6
```

## For each incident, cover

1. Are customers affected right now, and why or why not?
2. The root cause, with the line of evidence that shows it.
3. The immediate fix, and the change that stops it happening again.

For B, also say what you would look at to tell a memory leak from a limit that is simply too small. For A, say why the pipeline should have caught it and how.

## What is assessed

Whether each diagnosis follows from the evidence, whether you check customer impact before fixing, and whether each prevention step would really stop a repeat. There are no automated checks.
