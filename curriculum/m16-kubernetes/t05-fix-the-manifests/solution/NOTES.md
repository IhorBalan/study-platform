# Review notes

One line per problem you fixed: what was wrong, and what it would have done in the cluster.

1. The Deployment's selector (`catalog`) did not match its template labels (`catalog-api`). The API server rejects such a Deployment, so nothing would have been created. The Service and the PodDisruptionBudget select `catalog` too, so the template label was the one to change.
2. The Service sent traffic to `targetPort: 3000`, and the container listens on 8080. Every request would have been refused. It now points at the port name `http`.
3. The image tag was `latest`. Nobody can tell which build runs, a rollback pulls whatever `latest` is at that moment, and two nodes can run different builds. It is now the commit SHA.
4. The container had no resources. Without requests the scheduler places Pods blindly and the HPA has no base for its CPU percentage, so it never scales. Without a memory limit one leaking Pod can starve its node. No CPU limit, on purpose: it would only throttle.
5. The liveness probe called `/readyz`, which checks PostgreSQL. A short database problem would restart every Pod at once and turn a blip into an outage. Liveness now calls `/livez`.
6. There was no readiness probe, so a Pod received traffic as soon as its container started, before the app listened, and a rollout would have replaced healthy Pods with ones that cannot serve yet.
7. `runAsNonRoot: true` with an image that ends in `USER node` fails with `CreateContainerConfigError`: the kubelet cannot check a named user. `runAsUser: 1000` fixes it.
8. The Deployment set `replicas: 3` while an HPA manages the same Deployment. Every deploy would have reset the count to 3 in the middle of a traffic peak. On the live Deployment I would remove the field with `kubectl apply edit-last-applied` first.
9. The PodDisruptionBudget asked for `minAvailable: 3` with a minimum of 3 replicas, so no Pod could ever be evicted and every node drain would hang. It is now `maxUnavailable: 1`.
10. The Pod had 20 seconds to stop, of which the preStop sleep takes 10, and the app needs up to 20 to finish its requests. Long requests would have been killed on every deploy. The grace period is now 35 seconds.

Not changed: `readOnlyRootFilesystem` and a seccomp profile would harden the container further. I left them for a second pull request because the app writes its upload buffer to `/tmp`, which needs an `emptyDir` first.
