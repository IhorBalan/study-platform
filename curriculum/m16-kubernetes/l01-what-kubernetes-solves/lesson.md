---
title: What Kubernetes solves, and when not to use it
skills: [k8s-when-to-use]
---

Kubernetes runs containers across a group of machines and keeps them running the way you described. It is the default platform at many mid-size and large companies, so you will meet it in job ads and interviews. It is also one of the most common ways a small team wastes months. This lesson explains the problem it solves, the simpler options a small team should try first, and how to answer "should we use Kubernetes?" honestly.

## The problem

You built a Docker image of your NestJS API in module 1. Running one container on one machine is easy: `docker run`, or Compose. The trouble starts when you need more:

- **Several copies** of the API, so one crash or one slow machine does not take the product down.
- **Several machines**, because one is not enough, or because a machine can die.
- **Placement.** Something has to decide which container runs on which machine, given how much CPU and memory each one has free.
- **Self-healing.** When a container crashes or a machine disappears, something has to start a replacement somewhere else.
- **Deploys without downtime.** Replace version 41 with version 42 a few copies at a time, and stop if the new version is broken.
- **Service discovery and load balancing.** Containers come and go with new IP addresses. Callers need one stable name.
- **Configuration and secrets** delivered to each container without baking them into the image.
- **Scaling** up at 9 a.m. and down at night.

Kubernetes solves all of these with one idea: you write down the **desired state** ("three copies of image `api:42`, each with 256 MiB of memory, reachable as `api` on port 80") and a set of controllers works continuously to make the cluster match it. You never say "start a container on machine B". You say what should exist, and Kubernetes figures out the steps.

If you know React, the shape is familiar. You describe the UI as a function of state, and React reconciles the DOM to match. Kubernetes describes infrastructure as data, and controllers reconcile the machines to match. Lesson 2 goes into how.

## What it costs

Kubernetes is a platform for building platforms. Out of the box it gives you primitives, not a finished product. A production cluster also needs:

- An **ingress or gateway controller** for HTTP traffic, plus TLS certificates (usually cert-manager).
- **Logs, metrics and alerts** (module 12): a log shipper, Prometheus or a hosted equivalent, dashboards.
- **Secrets management** that is better than the default, such as an external secrets operator.
- **A deploy pipeline** with Helm or Kustomize and often a GitOps tool such as Argo CD or Flux.
- **Upgrades.** Kubernetes ships a minor version roughly every four months and each one is supported for about a year, so you upgrade the cluster and its add-ons several times a year, and occasionally fix manifests that use a removed API.
- **People who understand it** when it breaks at 3 a.m. Networking, DNS and scheduling problems in a cluster are harder to debug than on one VM.

A managed service (Amazon EKS, Google GKE, Azure AKS, DigitalOcean and others) runs the control plane for you. It does not remove the rest of the list. EKS also charges per cluster per hour before you run anything.

## Alternatives, from simplest

| Option | What you manage | Good fit |
| --- | --- | --- |
| **PaaS** (Railway, Render, Fly.io, Heroku) | Your code or image. Deploy on `git push`. | Most early products. One API, one database, a worker. |
| **Serverless containers** (Google Cloud Run, Azure Container Apps) | An image and a few settings. Scales to zero. | Stateless HTTP APIs with uneven traffic. |
| **AWS ECS on Fargate** | Task definitions and services. No machines. | Teams already on AWS who want a few services without a cluster. |
| **One VM with Docker Compose** | A machine, Compose, a reverse proxy, backups. | Internal tools, prototypes, very cheap production for small traffic. |
| **Kubernetes** (managed) | Manifests, add-ons, upgrades, the cluster's shape. | Many services, several teams, special scheduling or portability needs. |

Each row up the table removes work. A PaaS gives you rolling deploys, health checks, logs, TLS and scaling, which is most of what Kubernetes offers a small team, for no operational effort.

## When Kubernetes is worth it

Good reasons, especially in combination:

- **Many services and several teams** who need one consistent way to deploy, observe and secure them. Kubernetes becomes the shared platform, and a small platform team runs it.
- **Workloads a PaaS handles badly:** GPUs, long-running stateful systems, custom networking, per-customer isolated environments, or batch jobs mixed with web traffic on the same hardware.
- **Portability as a real requirement:** you must run on two clouds, or on a customer's own infrastructure (on-premises installs are often shipped as Helm charts).
- **Cost at scale.** Packing many services onto shared machines can be cheaper than per-service PaaS pricing once the bill is large enough to pay for the people.
- **The company already runs it well.** Adding a service to a working platform is cheap. Building the platform is not.

## When it is not

- A team of under about ten engineers with one to five services.
- No one on the team has run a cluster in production, and no one wants to be on call for it.
- The reason is "it looks good on a CV" or "we might need to scale". A PaaS handles the first million users of most products. You can move later; containers keep you portable.
- The product has not found its market. Every week spent on YAML is a week not spent on customers.

Interviewers at small companies often ask this exact question to check that you would *not* over-engineer. A strong answer names the cost, names a simpler option, and names the concrete signal that would change your mind: "When we have more than a handful of services owned by different teams, or a workload the PaaS cannot run, or the PaaS bill passes the cost of an engineer's time on a cluster."

## Common mistakes

- Choosing Kubernetes before having more than one or two services to run on it.
- Assuming a managed cluster means "no operations". The control plane is managed; everything you install on it is yours.
- Comparing a cluster's machine cost with a PaaS bill, and forgetting the engineering time.
- Treating "we can always migrate later" as a reason not to containerise. A good Dockerfile is what keeps the later move cheap.

## Go deeper

- [Kubernetes overview](https://kubernetes.io/docs/concepts/overview/): what Kubernetes is and, just as useful, what it is not.
- [Kubernetes release history](https://kubernetes.io/releases/): the release cadence and support windows you sign up for.
- [Google Cloud Run documentation](https://cloud.google.com/run/docs): a serverless container platform to compare against.
- [Amazon ECS documentation](https://docs.aws.amazon.com/ecs/): AWS's container service with Fargate, without a cluster to run.
