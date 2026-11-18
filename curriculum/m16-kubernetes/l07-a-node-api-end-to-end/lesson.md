---
title: Running a Node API on Kubernetes, end to end
skills: [k8s-delivery, k8s-health-scaling, k8s-config]
---

This lesson puts the previous six together. You get a complete, annotated set of manifests for a NestJS API, a one-page view of Helm and Kustomize, how a CI pipeline deploys to a cluster, and a "practise on your own" section with `kind` for when you want hands-on time. You do not need a cluster to follow it; read the manifests as a checklist of decisions.

## The manifests

The app: a NestJS API in the image `ghcr.io/acme/api`, listening on port 3000, with `/livez` and `/readyz` endpoints, reading config from env vars and the database URL from a Secret. Everything lives in the `shop` namespace.

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: shop
  labels:
    app.kubernetes.io/name: api
spec:
  # No "replicas": the HPA owns the count.
  revisionHistoryLimit: 5
  selector:
    matchLabels:
      app.kubernetes.io/name: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0                     # never drop below current capacity
  template:
    metadata:
      labels:
        app.kubernetes.io/name: api
    spec:
      terminationGracePeriodSeconds: 40     # preStop 10 s + drain up to 25 s + margin
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000                     # numeric: the kubelet cannot check a named user
        runAsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: api
      containers:
        - name: api
          image: ghcr.io/acme/api:3f9c2e1     # immutable tag: the git SHA, never "latest"
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - configMapRef:
                name: api-config
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: api-secrets
                  key: DATABASE_URL
            - name: NODE_OPTIONS
              value: "--max-old-space-size=384"   # below the 512Mi limit
          resources:
            requests:
              cpu: 250m
              memory: 384Mi
            limits:
              memory: 512Mi                 # no CPU limit: avoid throttling
          startupProbe:
            httpGet:
              path: /livez
              port: http
            periodSeconds: 2
            failureThreshold: 30
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /livez                  # checks the process only, never the DB
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          lifecycle:
            preStop:
              sleep:
                seconds: 10                 # let endpoint removal spread before SIGTERM
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
```

`runAsNonRoot` requires a numeric non-root user ID, set in the Pod with `runAsUser` or in the image with `USER 1000`. The Dockerfile from module 1 ends with `USER node`, a name the kubelet cannot verify, so without `runAsUser` the Pod fails with `CreateContainerConfigError` ("image has non-numeric user"). In the official Node images, `node` is UID 1000. `readOnlyRootFilesystem` means the app cannot write to its own disk; if it needs scratch space, mount an `emptyDir` volume at `/tmp`. The `app.kubernetes.io/name` label is a widely used convention; any consistent label works.

### Service, route, autoscaler and disruption budget

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: shop
spec:
  selector:
    app.kubernetes.io/name: api
  ports:
    - name: http
      port: 80
      targetPort: http
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: api
  namespace: shop
spec:
  parentRefs:
    - name: public
      namespace: infra
  hostnames: ["api.example.com"]
  rules:
    - backendRefs:
        - name: api
          port: 80
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
  namespace: shop
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api
  namespace: shop
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: api
```

The HTTPRoute attaches to a shared Gateway named `public` that the platform team runs (lesson 4). `targetPort: http` refers to the container port by name, so changing the number later touches one place.

### Migrations as a Job

Run migrations once per release, before the new Pods roll out, not in every Pod's start-up:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: api-migrate-3f9c2e1
  namespace: shop
spec:
  backoffLimit: 1
  activeDeadlineSeconds: 300
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ghcr.io/acme/api:3f9c2e1
          command: ["node", "dist/migrate.js"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: api-secrets
                  key: DATABASE_URL
```

## Helm and Kustomize in one page

Raw YAML repeats itself across environments: staging wants one replica and a different hostname, production wants the HPA. Two tools handle this.

**Kustomize** patches plain YAML. It is built into kubectl (`kubectl apply -k`). You keep a `base` and one overlay per environment:

```text
k8s/
  base/            deployment.yaml service.yaml pdb.yaml kustomization.yaml
  overlays/
    staging/       kustomization.yaml
    production/    kustomization.yaml hpa.yaml httproute.yaml
```

```yaml
# k8s/base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: shop
resources:
  - deployment.yaml
  - service.yaml
  - pdb.yaml
configMapGenerator:
  - name: api-config
    literals:
      - NODE_ENV=production
      - LOG_LEVEL=info
```

```yaml
# k8s/overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
  - hpa.yaml
  - httproute.yaml
images:
  - name: ghcr.io/acme/api
    newTag: "3f9c2e1"         # CI sets this with: kustomize edit set image ghcr.io/acme/api:<sha>
```

`configMapGenerator` adds a hash of the contents to the ConfigMap's name and rewrites references to it, so changing a value changes the Pod template and triggers a normal rolling update. That solves the "env vars are read once" problem from lesson 5.

**Helm** is a package manager and template engine. A **chart** is a folder of Go-templated YAML plus a `values.yaml` of defaults. You install a chart as a **release** and override values per environment:

```yaml
# templates/deployment.yaml (excerpt)
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

```sh
helm upgrade --install api ./chart -n shop -f values-production.yaml --set image.tag=3f9c2e1
helm history api -n shop
helm rollback api 12 -n shop
```

How to choose: **Kustomize** for your own apps, because the YAML stays readable and there is no template language to debug. **Helm** to install other people's software (cert-manager, a Gateway implementation, monitoring), which is almost always published as a chart, or when you ship your product to customers' clusters. Many teams use both. Helm 4 is the current major version.

## How deploys happen

A typical pipeline (module 14) on merge to `main`:

1. **Test and build** the image. Tag it with the **git SHA**, push it, and record its digest. Tags like `latest` make it impossible to know what is running and to roll back to a known version.
2. **Migrate.** Apply the migration Job and wait: `kubectl wait --for=condition=complete job/api-migrate-3f9c2e1 -n shop --timeout=5m`. Migrations must be backwards compatible, because old Pods keep serving during the rollout.
3. **Deploy.** Either:
   - **Push**: CI runs `kubectl apply -k k8s/overlays/production` (or `helm upgrade`) with credentials for the cluster, then `kubectl rollout status deploy/api -n shop --timeout=5m`, and runs `kubectl rollout undo` if that fails.
   - **GitOps (pull)**: CI commits the new tag to a config repository. **Argo CD** or **Flux**, running inside the cluster, notices the commit and applies it. Git is the record of what runs where, rollback is `git revert`, and CI needs no cluster credentials.
4. **Verify**: smoke tests against the public URL, and watch error rates (module 12) for a few minutes.

GitOps is the more common choice for teams that run Kubernetes seriously. Push is simpler to start with.

## Practise on your own with kind

`kind` (Kubernetes in Docker) runs a whole cluster as Docker containers on your laptop. Nothing here is checked; it is for when you want to see the behaviour from this module for yourself. Install `kind` and `kubectl` from their official pages, then:

```yaml
# kind.yaml: one control-plane node and two workers
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
```

```sh
kind create cluster --name lab --config kind.yaml
kubectl cluster-info --context kind-lab

# Build your API image from module 2 and load it into the cluster's nodes (no registry needed)
docker build -t api:dev .
kind load docker-image api:dev --name lab

kubectl create namespace shop
kubectl -n shop create secret generic api-secrets --from-literal=DATABASE_URL=postgres://...
# Edit the manifests: image api:dev, drop the HTTPRoute and HPA, then:
kubectl apply -k k8s/overlays/staging
kubectl -n shop rollout status deploy/api
kubectl -n shop port-forward svc/api 8080:80     # then curl localhost:8080/livez
```

Experiments worth doing:

1. **Self-healing.** `kubectl -n shop delete pod <one api pod>` and watch `kubectl -n shop get pods -w`.
2. **Readiness.** Make `/readyz` return 503 in one build. Deploy it and watch the rollout stall while the old Pods keep serving. Then `kubectl rollout undo`.
3. **Liveness gone wrong.** Point liveness at an endpoint that checks the database, stop the database, and watch every Pod restart.
4. **Graceful shutdown.** Run a load generator such as `autocannon` against the port-forward during a rollout, with and without the `preStop` sleep, and compare errors. (A port-forward goes to one Pod, so for a fair test call the Service from a Pod inside the cluster.)
5. **Drains and PDBs.** `kubectl drain lab-worker --ignore-daemonsets` and watch the PDB keep Pods available.
6. **OOMKilled.** Set a 128Mi memory limit and allocate memory in a route. Read the reason in `kubectl describe pod`.

The HPA needs metrics-server, which kind does not install by default. Delete the cluster with `kind delete cluster --name lab` when you are done.

## Common mistakes

- Deploying `latest`, so rollbacks and audits are guesswork.
- Running migrations inside the app's start-up on every replica.
- A pipeline that applies manifests and reports success without waiting for `rollout status`.
- Templating your own app with Helm when a small Kustomize overlay would do, then debugging Go templates.
- Running a database inside the kind cluster and treating that as practice for production. Use a managed database there.

## Go deeper

- [Kustomize task guide](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/): bases, overlays, generators and image overrides.
- [Helm documentation](https://helm.sh/docs/): charts, values, releases and rollback.
- [kind quick start](https://kind.sigs.k8s.io/docs/user/quick-start/): installation, multi-node configs and loading images.
- [Configure a security context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/): every field in the securityContext blocks above.
- [Argo CD documentation](https://argo-cd.readthedocs.io/): the GitOps model in practice.
