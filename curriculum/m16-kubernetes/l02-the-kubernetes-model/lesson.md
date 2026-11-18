---
title: "The model: control plane, nodes and reconciliation"
skills: [k8s-architecture]
---

Before you read a single Deployment, it helps to know who reads it and what they do with it. Kubernetes is a database of desired state plus a set of small programs that each watch one kind of object and nudge reality towards it. Once that clicks, most behaviour you will see, including the confusing parts, follows from it.

## The pieces of a cluster

A **cluster** is a set of machines called **nodes**, plus a **control plane** that manages them.

**Control plane** (on a managed service you never see these machines):

- **kube-apiserver.** The only front door. `kubectl`, controllers, your CI and the nodes all talk to it over HTTPS. It authenticates, authorises, validates and stores objects.
- **etcd.** A consistent key-value store that holds every object. If etcd is lost without a backup, the cluster's state is lost.
- **kube-scheduler.** Watches for Pods with no node assigned and picks one, based on requested CPU and memory, constraints and spreading rules.
- **kube-controller-manager.** Runs the built-in controllers: the Deployment controller, the ReplicaSet controller, the Job controller, the node controller and many more.
- **cloud-controller-manager.** Talks to the cloud provider, for example to create a load balancer when you ask for a `LoadBalancer` Service.

**Each node runs:**

- **kubelet.** The agent. It watches the API for Pods assigned to its node, asks the container runtime to start them, runs their probes, and reports status back.
- **A container runtime**, usually containerd. It pulls images and runs containers. Kubernetes runs any OCI image, so the image you built with Docker runs unchanged.
- **Networking.** A CNI plugin gives every Pod its own IP address, and kube-proxy (or a plugin that replaces it) routes Service traffic to Pods.

No component calls another directly to "do something". They all read and write objects through the API server.

## Desired state and reconciliation

Every object has two halves:

- **`spec`**: what you want. You write it.
- **`status`**: what is true now. The system writes it.

A **controller** is a loop: watch objects of one kind, compare `spec` with the world, take one step to close the gap, repeat. Follow `kubectl apply` of a Deployment with three replicas:

1. `kubectl` sends the manifest to the API server, which validates it and stores it in etcd.
2. The **Deployment controller** sees a Deployment without a matching ReplicaSet and creates one.
3. The **ReplicaSet controller** sees a ReplicaSet that wants three Pods and has zero, and creates three Pod objects. They exist only as records so far.
4. The **scheduler** sees three Pods with no node and assigns each one to a node.
5. The **kubelet** on each chosen node sees a Pod assigned to it, pulls the image and starts the containers.
6. Each kubelet reports status. The ReplicaSet and Deployment update their `status` to three ready replicas.

If a node dies later, its Pods are eventually marked as gone, the ReplicaSet controller sees two Pods instead of three, creates a new one, and the scheduler places it elsewhere. Nobody ran a command. That is **self-healing**, and it is the same loop as step 3.

Two consequences worth remembering:

- **Things are eventually consistent.** `kubectl apply` returns as soon as the object is stored, not when Pods are running. Use `kubectl rollout status` or `kubectl wait` when you need to wait.
- **Delete the owner, not the child.** If you delete a Pod that a ReplicaSet owns, the ReplicaSet creates a new one. To remove the Pods, scale or delete the Deployment.

## Manifests

Objects are usually written as YAML manifests. Every manifest has the same four top-level fields:

```yaml
apiVersion: v1          # API group and version. Core objects use plain "v1".
kind: Pod               # The type of object.
metadata:
  name: hello
  namespace: default
  labels:
    app: hello          # Key-value tags used by selectors.
spec:                   # Desired state. Its shape depends on kind.
  containers:
    - name: web
      image: nginx:1.29
      ports:
        - containerPort: 80
```

`apiVersion` matters. Objects move between versions as they mature (`v1beta1` to `v1`), and old versions are eventually removed. Deployments are `apps/v1`, Jobs and CronJobs `batch/v1`, Ingress `networking.k8s.io/v1`, HorizontalPodAutoscaler `autoscaling/v2`, PodDisruptionBudget `policy/v1`. A manifest copied from an old blog post may use a version your cluster no longer serves; the official deprecation guide lists what was removed in which release.

**Labels and selectors** connect objects loosely. A Service does not list Pods by name. It says "send traffic to every Pod with `app: api`", and whatever Pods carry that label at the moment receive traffic. The same mechanism ties a Deployment to its Pods. A typo in a label is therefore a common reason for "my Service has no endpoints".

## kubectl

`kubectl` is the command-line client for the API server. It reads its cluster address and credentials from `~/.kube/config`, which holds one or more **contexts** (cluster plus user plus default namespace).

```sh
kubectl config get-contexts              # which clusters can I talk to?
kubectl config use-context staging       # switch. Check this before every write.
kubectl apply -f k8s/                    # create or update everything in a folder
kubectl get pods -o wide                 # list, with node and IP
kubectl describe pod api-7c9d4-x2k8p     # details and recent events: start here when debugging
kubectl logs deploy/api --previous       # logs of the previous (crashed) container
kubectl explain deployment.spec.strategy # built-in reference for any field
kubectl diff -f k8s/                     # what would apply change?
```

Prefer **declarative** `kubectl apply -f` with files kept in git over imperative commands such as `kubectl create deployment` or `kubectl edit`. Files can be reviewed, diffed and re-applied; an edit made by hand is lost on the next deploy and nobody knows it happened.

## Common mistakes

- Running a write command against the wrong context. Show the current context in your shell prompt.
- Deleting Pods to "stop" an app that a Deployment owns. They come straight back.
- Copying manifests with removed API versions such as `extensions/v1beta1`.
- Treating `kubectl apply` success as deploy success.
- Changing live objects with `kubectl edit` and then being surprised when the next deploy reverts it.

## Go deeper

- [Cluster architecture](https://kubernetes.io/docs/concepts/architecture/): the components and how they communicate.
- [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/): the control loop in the project's own words.
- [Objects in Kubernetes](https://kubernetes.io/docs/concepts/overview/working-with-objects/): spec, status, names, labels and selectors.
- [Deprecated API migration guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/): which API versions were removed in which release.
- [kubectl reference](https://kubernetes.io/docs/reference/kubectl/): every command and flag.
