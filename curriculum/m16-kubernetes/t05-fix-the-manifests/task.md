A colleague opened a pull request with the manifests for a new service. They are in `k8s/`. Ten things in them are wrong, and several would take the service down. Fix the files, and write down what you found.

## The service

`catalog` is a Node API in the namespace `shop`.

- It listens on port 8080. The route in front of it sends traffic to the Service on port 80.
- `GET /livez` answers 200 while the process runs. `GET /readyz` also checks PostgreSQL.
- On SIGTERM it stops accepting connections and needs up to 20 seconds to finish the requests it has.
- Its Dockerfile ends with `USER node`. In the official Node images that user has the ID 1000.
- The image is `ghcr.io/acme/catalog`, tagged with the commit SHA of each build. The current one is `8c1f4d2`.
- An autoscaler runs between 3 and 9 Pods on CPU.

## What to do

Edit the files in `k8s/`. Keep one Deployment, one Service, one HorizontalPodAutoscaler and one PodDisruptionBudget, with their names and the namespace. You may move objects between files. Keep the rolling update strategy and a preStop sleep of at least 5 seconds.

In `NOTES.md`, write one line per problem: what was wrong and what it would have done in the cluster.

Lessons 3 to 7 cover every rule you need. You do not need a cluster. If you have one (`kind` is enough), `kubectl apply --dry-run=server -f k8s/` shows what the API server thinks.

## What is checked

The checks read your YAML and never talk to a cluster. They look at: selectors against the Pod labels, the Service's target port, the image tag, resource requests and the memory limit, the paths of the probes, `runAsNonRoot` with a numeric user, `replicas` against the autoscaler, what the disruption budget allows, and the grace period against the preStop sleep plus the 20 seconds above.

The checks read plain YAML: mappings, lists, strings and numbers, with `[..]` and `{..}` on one line. Do not use anchors or aliases.

A reviewer then reads `NOTES.md` and your values.
