---
title: "Networking: Services, DNS, Ingress and the Gateway API"
skills: [k8s-networking]
---

Pods come and go with new IP addresses, so nothing should talk to a Pod directly. Kubernetes gives you a stable name and address in front of a changing set of Pods (a **Service**), a DNS name for it, and a way to let HTTP traffic in from the internet (**Ingress**, or its successor, the **Gateway API**). This lesson walks through each, from the inside of the cluster outwards.

## The network model in one paragraph

Every Pod gets its own IP address, and every Pod can reach every other Pod's IP without NAT, across nodes. A CNI plugin (Calico, Cilium, the cloud's own) makes that true. By default there is no firewall between Pods; a **NetworkPolicy** can restrict who talks to whom, if your CNI plugin enforces it. Containers in one Pod share the IP and talk over `localhost`.

## Services

A Service selects Pods by label and gives them one virtual IP and DNS name. Traffic to the Service is spread across the Pods that match **and are ready**.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: shop
spec:
  type: ClusterIP          # the default
  selector:
    app: api               # Pods with this label...
  ports:
    - name: http
      port: 80             # ...are reachable on the Service's port 80
      targetPort: 3000     # ...which forwards to the container's port 3000
```

`port` is what callers use. `targetPort` is what the container listens on. Mixing them up is a classic cause of "connection refused".

Behind the scenes, an **EndpointSlice** controller keeps the list of ready Pod IPs for each Service, and kube-proxy (or the CNI plugin) programs each node to send traffic for the Service's IP to one of them. When a Pod fails its readiness probe or starts shutting down, it is removed from that list. That is the link between probes and zero-downtime deploys in lesson 6.

### Service types

| Type | Reachable from | Use |
| --- | --- | --- |
| `ClusterIP` | Inside the cluster only | Almost every Service. APIs called by other Pods or by a gateway. |
| `NodePort` | Every node's IP on a port in 30000–32767 | Rarely directly; local clusters and some bare-metal setups. |
| `LoadBalancer` | A cloud load balancer the provider creates | Exposing one Service, or the gateway itself, to the internet. |
| Headless (`clusterIP: None`) | DNS returns the Pod IPs directly | StatefulSets, clients that balance themselves. |

Each `LoadBalancer` Service usually costs one cloud load balancer. With ten public services you do not want ten; you want one entry point that routes by host and path. That is what Ingress and the Gateway API are for.

## DNS

The cluster runs a DNS server (CoreDNS). Every Service gets a name:

```text
api.shop.svc.cluster.local     full name: <service>.<namespace>.svc.<cluster domain>
api.shop                       from another namespace
api                            from a Pod in the same namespace
```

So your NestJS API reads `REDIS_URL=redis://cache:6379` and finds the `cache` Service in its own namespace. No IPs in config, ever. Like Compose service names in module 1, but cluster-wide.

## Ingress

An **Ingress** is a set of HTTP routing rules: host and path to Service. It does nothing by itself. An **ingress controller** (a reverse proxy running in the cluster, usually behind one `LoadBalancer` Service) reads Ingress objects and configures itself.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api
  namespace: shop
spec:
  ingressClassName: example-controller   # which controller handles it
  tls:
    - hosts: ["api.example.com"]
      secretName: api-example-com-tls    # a Secret of type kubernetes.io/tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 80
```

Ingress is stable and widely used, and you will see it in most existing clusters. Its weakness is that the spec covers only hosts, paths and TLS. Everything else (timeouts, header rewrites, canary weights, body size limits) lives in **controller-specific annotations**, so manifests are not portable between controllers. The Kubernetes project has frozen the Ingress API: it stays, but new features go into the Gateway API.

One historical note you will hear about: the community **ingress-nginx** controller, once the most common choice, was retired in March 2026 and no longer receives releases or security fixes. Clusters that still run it should migrate to the Gateway API or another maintained controller. This is about that one controller, not the Ingress API.

## The Gateway API

The **Gateway API** is the newer, more expressive set of resources for traffic into (and within) the cluster. Its core types have been generally available (`gateway.networking.k8s.io/v1`) for several releases. It is installed as CRDs (custom resource definitions) together with an implementation, such as Envoy Gateway, Istio, Cilium, Traefik, NGINX Gateway Fabric, or the cloud provider's own controller.

It splits the job by role:

- **GatewayClass**: which implementation. Set up by whoever runs the cluster.
- **Gateway**: one entry point with listeners (ports, protocols, hostnames, TLS). Owned by the platform team.
- **HTTPRoute**: routing rules for one app. Owned by the app team, in the app's namespace.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public
  namespace: infra
spec:
  gatewayClassName: example-gateway-class
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "*.example.com"
      tls:
        mode: Terminate
        certificateRefs:
          - name: wildcard-example-com-tls
      allowedRoutes:
        namespaces:
          from: All
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
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: api
          port: 80
          weight: 90
        - name: api-canary
          port: 80
          weight: 10
```

Things that needed annotations in Ingress are fields here: weighted backends (the 90/10 canary above), header matches, redirects, rewrites, request timeouts. The role split also means an app team can change its routes without being able to change the shared TLS listener.

Which to choose? On a new cluster, start with the Gateway API. On an existing cluster, keep the Ingress objects that work, and plan a move if the controller behind them is unmaintained.

## How a request reaches your API

1. DNS for `api.example.com` points at the cloud load balancer.
2. The load balancer forwards to the gateway (or ingress controller) Pods, through their `LoadBalancer` Service.
3. The gateway terminates TLS, matches the host and path against its routes, and picks the `api` Service.
4. It sends the request to one of the ready Pod IPs behind that Service.
5. Your Node process answers on port 3000.

When requests fail, walk this chain from both ends: does the gateway see the route, and does the Service have endpoints (`kubectl get endpointslices -l kubernetes.io/service-name=api`)?

## Common mistakes

- Service `selector` labels that do not match the Pod labels, giving a Service with no endpoints.
- Confusing `port` and `targetPort`, or the app listening on `127.0.0.1` instead of `0.0.0.0` inside the container.
- One `LoadBalancer` Service per app instead of one shared entry point.
- Ingress annotations copied from a different controller, which are silently ignored.
- Hard-coding Pod IPs or full cluster domain names in config.

## Go deeper

- [Service](https://kubernetes.io/docs/concepts/services-networking/service/): types, ports, selectors and EndpointSlices.
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/): the naming rules in full.
- [Gateway API concept page](https://kubernetes.io/docs/concepts/services-networking/gateway/): the resource model and role split.
- [Gateway API project site](https://gateway-api.sigs.k8s.io/): guides, the list of implementations and migration from Ingress.
- [Ingress NGINX retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/): what was retired and what to do about it.
