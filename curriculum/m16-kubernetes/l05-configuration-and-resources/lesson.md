---
title: "Configuration: ConfigMaps, Secrets, resources and namespaces"
skills: [k8s-config]
---

The same image should run in staging and production. What differs is configuration, secrets and how much CPU and memory each copy gets. This lesson covers how Kubernetes delivers config and secrets to a container, what a Secret really protects (less than its name suggests), how a Pod gets cloud credentials without one, how resource requests and limits work, and how namespaces divide a cluster.

## ConfigMaps

A **ConfigMap** holds non-secret key-value configuration.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
  namespace: shop
data:
  NODE_ENV: production
  LOG_LEVEL: info
  CORS_ORIGINS: "https://app.example.com"
```

A container can consume it in two ways:

- **As environment variables**, with `envFrom` (all keys) or `env[].valueFrom.configMapKeyRef` (one key). This fits a Node app that reads `process.env` and validates it at start-up with zod, as in module 2.
- **As files**, by mounting the ConfigMap as a volume. Each key becomes a file. Good for whole config files such as a `pino` transport config.

Changes behave differently:

- **Environment variables are read once**, when the container starts. Changing the ConfigMap does nothing to running Pods. You need a new rollout (`kubectl rollout restart`, or a template change).
- **Mounted files are updated** in running Pods after a delay, but your app must notice and reload, which most do not.

A common pattern is to put a hash of the config into a Pod template annotation (Helm and Kustomize can do this), so any config change becomes a template change and triggers a normal rolling update.

## Secrets

A **Secret** looks like a ConfigMap, for sensitive values.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
  namespace: shop
type: Opaque
stringData:                      # plain text in; stored base64-encoded under data
  DATABASE_URL: "postgres://api:change-me@db.internal:5432/shop"
```

### Base64 is not encryption

`kubectl get secret api-secrets -o yaml` shows the values under `data` in **base64**. That is an encoding so binary data fits in YAML. Anyone can decode it:

```sh
kubectl get secret api-secrets -n shop -o jsonpath='{.data.DATABASE_URL}' | base64 -d
```

What actually protects a Secret:

- **RBAC.** Who may `get` or `list` Secrets in the namespace. Note that anyone who can create a Pod in that namespace can mount any Secret there and read it, so Pod-creation rights are Secret-read rights.
- **Encryption at rest in etcd.** Not on by default in a self-managed cluster; it is a setting on the API server, often backed by a cloud KMS. Managed providers differ, so check yours.
- **Keeping Secrets out of git.** A Secret manifest in the repository is a password in the repository, base64 or not.

In practice, teams keep the real values in a secret manager (AWS Secrets Manager, GCP Secret Manager, Vault) and sync them into the cluster with a tool such as the **External Secrets Operator**, or encrypt them in git with **Sealed Secrets** or **SOPS**. The manifest in git then holds a reference or ciphertext, never the value.

### Using a Secret in a Deployment

```yaml
containers:
  - name: api
    image: ghcr.io/acme/api:1.43.0
    envFrom:
      - configMapRef:
          name: api-config
    env:
      - name: DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: api-secrets
            key: DATABASE_URL
```

Never write the value as a literal (`env: [{ name: DATABASE_URL, value: "postgres://..." }]`) in the Deployment. It ends up in git, in `kubectl get deploy -o yaml` for anyone with read access to Deployments, and in CI logs.

Mounting a Secret as files instead of env vars has two advantages: values are not visible in the process environment that crash reporters and child processes inherit, and rotated values reach running Pods. Env vars are simpler and fine for most APIs, as long as your logger never dumps `process.env`.

## Cloud credentials without a Secret: workload identity

The API needs to read from S3. The tempting answer is a Secret holding an AWS access key. That key never expires, works from anywhere, and is exactly the kind of long-lived credential modules 11 and 15 taught you to avoid. Kubernetes has a better building block.

Every Pod runs as a **ServiceAccount**, an identity inside the cluster (`default` if you name none). It has two uses. Inside the cluster, RBAC `Role` and `RoleBinding` objects grant a ServiceAccount rights on the Kubernetes API, such as reading ConfigMaps; most application Pods need none, and can set `automountServiceAccountToken: false` so that no Kubernetes API token is mounted at all. Outside the cluster, a cloud provider can trust that identity and exchange it for a cloud role.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api
  namespace: shop
---
# in the Deployment's Pod template
spec:
  serviceAccountName: api
```

On EKS, **EKS Pod Identity** links a ServiceAccount to an IAM role with one association (cluster, namespace, ServiceAccount, role). An agent on each node hands the Pod short-lived credentials for that role, and the AWS SDK picks them up through its default credential chain, so the application code contains no key and no special setup. The older mechanism, **IRSA** (IAM Roles for Service Accounts), does the same job by annotating the ServiceAccount with a role ARN and trusting the cluster's OIDC issuer; you will still meet it in many clusters. GKE and AKS have equivalents (Workload Identity Federation for GKE, Microsoft Entra Workload ID).

The result is the same least-privilege shape as everywhere else in the course: one role per workload, only the permissions it needs, credentials that expire in hours, and nothing to leak from git or `kubectl get secret`. Give each workload its own ServiceAccount; Pods that share the `default` one share whatever it is allowed to do.

## Resource requests and limits

Each container can declare CPU and memory:

```yaml
resources:
  requests:
    cpu: 250m          # a quarter of a CPU core
    memory: 256Mi
  limits:
    memory: 512Mi      # hard ceiling
```

- **Requests** are what the scheduler reserves. A Pod is placed only on a node with that much unreserved capacity. Requests also drive the HorizontalPodAutoscaler's percentages (lesson 6). Without requests, the scheduler packs Pods blindly and noisy neighbours starve each other.
- **Memory limit**: if the container goes over, the kernel kills it. The status says `OOMKilled` and the container restarts.
- **CPU limit**: the container is **throttled**, not killed. Requests slow down, often in short bursts that are hard to spot. Many teams set a CPU request and no CPU limit for latency-sensitive services, so a Pod can use idle CPU on its node. Others set limits for predictability. Know the trade-off and pick on purpose.

Units: `cpu: 1` is one core, `500m` is half. Memory uses `Mi` and `Gi` (powers of two); `M` is powers of ten and a common typo.

### Node.js and memory limits

A Node process has a heap limit separate from the container's limit. If V8's heap is allowed to grow past the container limit, the kernel kills the process with `OOMKilled` and no JavaScript error or heap snapshot. Set the heap explicitly below the limit, leaving room for buffers and native memory:

```dockerfile
ENV NODE_OPTIONS="--max-old-space-size=384"   # about 75% of a 512Mi limit
```

Also remember that one Node process uses about one CPU core for JavaScript. Requesting four cores for one Node container wastes three; run more replicas instead.

### Quality of service

Kubernetes derives a QoS class from your settings. It decides who is evicted first when a node runs out of memory:

- **Guaranteed**: requests equal limits for CPU and memory in every container. Evicted last.
- **Burstable**: some requests or limits set. The usual case.
- **BestEffort**: nothing set. Evicted first.

## Namespaces

A **namespace** is a named scope for objects. Names are unique within a namespace, and most policies attach to one:

- **RBAC**: give a team rights in its namespace only.
- **ResourceQuota**: cap total CPU, memory and object counts per namespace.
- **LimitRange**: default requests and limits for containers that set none.
- **NetworkPolicy**: restrict traffic per namespace.

Common layouts: one namespace per team or per app, plus one per environment if staging and production share a cluster. Many companies use separate clusters for production, which isolates far more strongly than namespaces. A namespace is an organisational boundary, not a hard security boundary: Pods in different namespaces still share nodes and, by default, the network.

```sh
kubectl get pods -n shop
kubectl config set-context --current --namespace=shop   # make it the default
```

## Common mistakes

- Committing Secret manifests to git and believing base64 hides them.
- Secret values as literals in the Deployment's `env`.
- Expecting a ConfigMap change to reach running Pods that read it as env vars.
- No resource requests, so scheduling and autoscaling work from guesses.
- A memory limit without a Node heap limit, giving silent `OOMKilled` restarts.
- `memory: 512M` when `512Mi` was meant.
- Treating namespaces as a security boundary between untrusted tenants.

## Go deeper

- [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/): every way to consume them and how updates propagate.
- [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/): types, risks and the safety notes worth reading in full.
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/): encryption at rest, RBAC and access patterns.
- [Resource management for Pods and containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): requests, limits and units.
- [Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/): what is and is not namespaced.
