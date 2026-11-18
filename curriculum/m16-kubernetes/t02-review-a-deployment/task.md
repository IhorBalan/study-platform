Review a colleague's manifests for a Node API before they go to production. Write a code review: what is wrong, why it matters, and how to fix it. Then give a corrected version.

## The pull request

The `orders` service is a NestJS API that listens on port 3000. Its `/health` handler runs `SELECT 1` against PostgreSQL and calls the Stripe API to check the key works, then returns 200. The Dockerfile ends with `USER node`. The cluster runs a current Kubernetes version with a Gateway API implementation already installed by the platform team.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders
spec:
  replicas: 1
  selector:
    matchLabels:
      app: orders
  template:
    metadata:
      labels:
        app: orders-api
    spec:
      containers:
        - name: orders
          image: acme/orders:latest
          command: ["sh", "-c", "npm run migrate && npm run start:prod"]
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              value: "postgres://orders:S3cr3t-pa55@db.prod.internal:5432/orders"
            - name: STRIPE_SECRET_KEY
              value: "<the live Stripe key, pasted here>"
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
          securityContext:
            privileged: true
---
apiVersion: v1
kind: Service
metadata:
  name: orders
spec:
  type: LoadBalancer
  selector:
    app: orders
  ports:
    - port: 80
      targetPort: 8080
```

## What to submit

1. **A list of problems**, ordered from most to least serious. For each: the line or field, what goes wrong in practice (what the team would see, or what an attacker could do), and the fix. Some problems stop the manifests from working at all; some cause outages; some are security risks.
2. **A corrected manifest set** in YAML: the Deployment and Service, plus anything else you think this service needs (for example a Secret reference, a migration Job, a PodDisruptionBudget, an HTTPRoute). It must be valid for a current Kubernetes version. Use placeholders for values you do not know.
3. **Two sentences** on anything that cannot be fixed in the manifests alone and needs a change in the app or the Dockerfile.

## What is assessed

How many of the real problems you find, whether each explanation names the concrete consequence, whether your ordering is sensible, and whether the corrected manifests are valid and fix what you listed. There are no automated checks.
