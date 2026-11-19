---
title: "Compute options: Lambda, containers and servers"
skills: [aws-compute]
---

Your code has to run somewhere. AWS offers a spectrum from "you manage a whole machine" to "you upload a function", and the choice decides your bill, your operational work, how your app scales and which designs are possible. This lesson compares the four options you are most likely to meet as a NestJS developer (EC2, ECS on Fargate, App Runner and Lambda) and ends with a way to choose.

## The spectrum

The more AWS manages, the less you can change and the less you have to do.

| | EC2 | ECS on Fargate | Lambda |
|---|---|---|---|
| You provide | A machine image or setup script | A container image | A function (zip or image) |
| You manage | OS, patches, scaling, process supervision | Image, task size, scaling rules | Code and settings |
| Runs | All the time | All the time (tasks) | Per event, up to 15 minutes |
| Billed | Per second while running | Per second for vCPU and memory of running tasks | Per request and per ms of duration × memory |
| Scales | Auto Scaling groups, minutes | Service auto scaling, about a minute | Per request, in milliseconds to seconds |
| Idle cost | Full | Full for the tasks you keep | None |

## EC2: a virtual machine

EC2 gives you a virtual server. You choose the instance type, install Node or Docker, keep the OS patched, run a process manager, put a load balancer in front and configure Auto Scaling groups. It is the most flexible option and the most work. Reasons to choose it today: GPUs, special hardware or kernel features, software that is not containerised, or the lowest price per CPU for steady load with reserved capacity or Savings Plans. For a typical web API, a container service gives you the same result with less to maintain.

## ECS on Fargate: containers without servers

**ECS** (Elastic Container Service) runs containers. You write a **task definition** (image, CPU and memory, environment, secrets, task role, port, log configuration) and a **service** that keeps N copies of the task running behind an **Application Load Balancer**, replaces unhealthy ones, and rolls out new versions. **Fargate** is the launch type where AWS provides the machines, so there are no instances to patch or scale.

This is the natural home of a NestJS API on AWS: the Docker image from module 1, listening on a port, with health checks, graceful shutdown on `SIGTERM`, and a task role for its permissions. It also suits long-running workers such as the SQS consumer from lesson 3, which simply runs as a second service from the same image with a different command.

Fargate costs more per CPU-hour than EC2 and has a minimum: tasks run, and are billed, whether or not requests arrive. Scaling adds tasks in about a minute, so a sudden ten-times spike is absorbed by headroom, not by instant scaling.

**ECS Express Mode**, announced in late 2025, sets up the load balancer, networking, scaling and HTTPS for a container from a few inputs, which makes the simple case close to a PaaS. Under it is a normal ECS service you can grow into.

EKS (Kubernetes) is the other container option. Module 16 covers when it is worth its complexity; for a small team, ECS is usually enough.

## App Runner

App Runner was AWS's "give us an image or a repository, get an HTTPS URL" service, with scaling built in. AWS moved it to maintenance in 2026: since 30 April 2026 it accepts no new customers, and AWS recommends ECS Express Mode instead. You will still meet it in existing systems and older tutorials. For new work, choose Fargate (with Express Mode) or a PaaS outside AWS.

## Lambda: functions per event

**Lambda** runs a function in response to an event: an HTTP request (through API Gateway or a function URL), an SQS message, an EventBridge rule or schedule, an S3 upload, a DynamoDB stream record. AWS starts execution environments as needed, runs one event at a time in each, and freezes or discards them when idle. You pay for the number of requests and the duration multiplied by the configured memory, which also sets the CPU share.

Strengths:

- **No idle cost.** A function called a thousand times a day costs almost nothing.
- **Event integrations** handled for you: the SQS poller, retries, batching and partial failures are configuration, not code.
- **Fast, fine-grained scaling** for bursty, short tasks.

Constraints:

- **15 minutes** maximum per invocation for standard functions. (Lambda Managed Instances, a newer mode that runs functions on EC2 capacity you choose, allows longer asynchronous runs; it trades away much of the "no servers, no idle cost" model.)
- **Cold starts**: a new environment loads your code before the first event. For a small Node function it is a fraction of a second; for a full NestJS app with many modules it can be much longer.
- **No long-lived state**: no in-memory cache you can rely on, no WebSocket server, no background work after the response.
- **Concurrency per region** is limited (a default account quota that you can raise), and each concurrent environment opens its own database connections. A spike can exhaust Postgres connections unless you use RDS Proxy or a pooler.
- **Per-request cost at steady high load** exceeds a container that is busy all the time.

### Where a NestJS API fits

A NestJS API is a long-running server with a container that boots modules, pools connections and handles many requests concurrently. That matches **ECS on Fargate** well. You can run Nest in Lambda behind an adapter, and some teams do for low-traffic internal APIs, but you pay a cold start for initialising the whole app, you serve one request per environment, and you multiply database connections. The usual split on AWS is: the API and its main workers on Fargate, and Lambda for the event-shaped edges around it.

## Choosing for a workload

Ask four questions:

1. **How long does one unit of work take?** Over 15 minutes rules out Lambda.
2. **Is the load steady or bursty?** Steady and high favours containers; idle most of the time with spikes favours Lambda.
3. **Does it hold connections or state?** WebSockets, in-memory caches, large connection pools and warm models favour containers.
4. **Is it triggered by an AWS event?** A thumbnail per S3 upload, a nightly schedule, a small SQS consumer: Lambda's integrations remove code you would otherwise write.

Examples:

| Workload | Choice | Why |
|---|---|---|
| Main REST API with Postgres, steady traffic | Fargate | Long-running, connection pool, predictable cost |
| Resize an image after each upload | Lambda | Short, event-triggered, idle most of the time |
| Nightly report that takes 40 minutes | Fargate task (scheduled by EventBridge) | Exceeds Lambda's limit |
| Stripe webhook receiver with low volume | Either; Lambda if the API is not already running | Short and bursty |
| WebSocket chat server | Fargate | Long-lived connections |
| Video transcoding with a GPU | EC2 (or AWS Batch on EC2) | Special hardware |

Interviewers asking "when would you use Lambda instead of a long-running service?" want this reasoning: short, event-driven, spiky or rare work goes to Lambda; long, steady, stateful or connection-heavy work goes to a container. Saying that the first version of a product can run entirely on one container service, and that Lambda is added for specific events, also shows you will not over-engineer.

## A typical small-team AWS layout

"How would you deploy this API on AWS?" expects a picture of the network as well as the compute. This is the usual one:

```text
              internet
                 |
        +--------+---------------------------- VPC ---+
        |  public subnets (one per zone)              |
        |    load balancer (ALB)      NAT gateway     |
        |        |                        ^           |
        |  private subnets (one per zone) |           |
        |    ECS tasks (the API, workers) +           |
        |        |                                    |
        |    RDS Postgres                             |
        +---------------------------------------------+
```

- A **VPC** is your private network in one region. It is cut into **subnets**, each in one availability zone. Use at least two zones so one failing zone does not take the service down.
- A subnet is **public** when its route table sends internet traffic to an internet gateway, and **private** when it does not. Only the load balancer sits in public subnets. Tasks and the database sit in private ones, so nothing on the internet can open a connection to them.
- A **security group** is the firewall around one resource. It is stateful: allow a request in and the reply goes out automatically. A rule can name another security group as the source, which gives the standard chain: the load balancer accepts 443 from anywhere, the tasks accept their port only from the load balancer's group, and the database accepts 5432 only from the tasks' group.
- A **network ACL** is a filter on a whole subnet. It is stateless (replies need their own rule) and can deny. Most teams leave ACLs open and do the work in security groups.
- Tasks in private subnets still need to reach out: to pull images, call Stripe, send logs. A **NAT gateway** in a public subnet gives them outbound access. It bills by the hour and per gigabyte, so one per zone is a visible line on a small bill; staging often runs with one.
- **VPC endpoints** keep traffic to AWS services off the NAT. Gateway endpoints for S3 and DynamoDB cost nothing. Interface endpoints (SQS, ECR, Secrets Manager, CloudWatch Logs) bill by the hour each, so add them where the traffic or a security rule justifies it.

A Lambda that talks to RDS must be attached to the VPC, and then it has no internet access unless it goes through the NAT or an endpoint. It also brings a connection problem: every concurrent invocation opens its own database connection, and a burst of a few hundred exhausts Postgres. **RDS Proxy** sits between them and shares a small pool of real connections. A long-running Fargate service with its own pool does not need it.

## Common mistakes

- Running the whole NestJS monolith in Lambda by default and then fighting cold starts and connection limits.
- Choosing EC2 for a plain web API and taking on patching for no gain.
- Forgetting that Fargate tasks cost money while idle, and leaving staging running at production size.
- Starting a new project on App Runner, which no longer takes new customers.
- Picking by fashion instead of by duration, load shape and state.

## Go deeper

- [Amazon ECS on AWS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html): task sizes, networking and platform versions.
- [Announcing Amazon ECS Express Mode](https://aws.amazon.com/about-aws/whats-new/2025/11/announcing-amazon-ecs-express-mode): what Express Mode sets up for you.
- [AWS App Runner availability change](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html): the maintenance notice and migration advice.
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html): timeout, memory, payload and concurrency limits.
