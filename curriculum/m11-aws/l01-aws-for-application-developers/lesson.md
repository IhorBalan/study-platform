---
title: AWS for an application developer
skills: [aws-basics]
---

AWS has more than two hundred services, and a backend developer at a small company uses perhaps ten of them. This module covers the ones you meet in application code: IAM for permissions, SQS, SNS and EventBridge for messages, DynamoDB for data, SSM and Secrets Manager for configuration, and the compute services that run your code. This first lesson gives you the map: how an account is organised, who is responsible for what, the four ways to talk to AWS, how not to get a surprise bill, and how to practise against a local emulator.

## Accounts, regions and ARNs

An **AWS account** is the unit of billing and the outer boundary of security. Nothing in one account can touch another account unless a policy explicitly allows it. Companies use several accounts on purpose: one for production, one for staging, one per developer sandbox, grouped under an **organization** with central billing. A mistake in the staging account cannot delete production data, because production is somewhere else entirely.

A **region** (`eu-central-1`, `us-east-1`) is a geographic location with its own copy of most services. Resources live in one region: a queue created in Frankfurt does not exist in Virginia. Each region has several **availability zones**, separate data centres a few kilometres apart. Managed services such as SQS and DynamoDB already spread your data across zones; for things you run yourself (containers, databases), you choose to run in at least two zones.

Pick the region close to your users and the one your data must live in for legal reasons. Some services and features arrive in `us-east-1` first, and a few global ones (IAM, CloudFront certificates) are anchored there.

Every resource has an **ARN**, Amazon Resource Name, which you will write in policies and event targets:

```text
arn:aws:sqs:eu-central-1:123456789012:orders-email
arn:aws:dynamodb:eu-central-1:123456789012:table/orders
arn:aws:dynamodb:eu-central-1:123456789012:table/orders/index/*
```

Partition, service, region, account, resource. IAM ARNs have an empty region because IAM is global.

## The shared responsibility model

AWS secures the cloud; you secure what you put in it. AWS runs the data centres, the hardware, the hypervisors and the managed services' internals. You decide who can call those services, what is public, what is encrypted with which key, and what your code does with the data.

The split moves with the level of service. On an EC2 virtual machine you patch the operating system. On Fargate AWS patches the host and you own the container image. On Lambda or DynamoDB you own only your code, data and permissions. The breaches you read about are almost never AWS's side: they are an S3 bucket made public, an access key committed to GitHub, a role with `*` permissions. That is why IAM gets the next lesson to itself.

## Four ways to talk to AWS

Every action, whatever the tool, ends as a signed HTTPS request to a service API. The tools differ in who makes the request and whether it is repeatable.

| Tool | Good for | Not for |
|---|---|---|
| Console (web UI) | Exploring, reading metrics and logs, one-off investigations | Creating anything you need to recreate |
| CLI (`aws ...`) | Scripts, quick queries, debugging | Long-lived infrastructure |
| SDK (`@aws-sdk/client-*`) | Your application's runtime calls: send a message, read an item | Creating the queue or table it uses |
| Infrastructure as code (OpenTofu, Terraform, CDK, CloudFormation) | Every resource that should exist tomorrow | Data |

The rule of thumb: **infrastructure in code, data through the SDK, the console for looking.** A table created by clicking in the console has no history, no review and no copy in staging. Module 15 covers OpenTofu. In this module the tasks create resources with the SDK, because the checks need to build and remove them in seconds, but the lessons point out where IaC belongs.

### The SDK, briefly

Module 9 introduced the JavaScript SDK v3 with S3. Every service in this module works the same way: one package per service, one client per process, one command class per API call.

```ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({}); // region, credentials and endpoint come from the environment
await sqs.send(new SendMessageCommand({
  QueueUrl: process.env.ORDERS_QUEUE_URL,
  MessageBody: JSON.stringify({ orderId: 'o_123' }),
}));
```

Two habits from module 9 matter most here. Create a client once per process and reuse it, because it holds an HTTP connection pool. And know where it gets its credentials. The client finds its settings in a fixed order, the **default credential provider chain**: explicit options, then environment variables (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_ENDPOINT_URL`, ...), then the shared config files in `~/.aws`, then, on AWS compute, the role attached to the container or function. That last step is why production code never contains a key: the same `new SQSClient({})` picks up the workload's role on AWS and your profile on your laptop.

Errors are thrown as exceptions whose `name` is the service's error code, such as `ConditionalCheckFailedException` or `ResourceNotFoundException`. Check `error.name`, not the message text. The SDK already retries throttling and transient network errors with backoff (three attempts by default), so do not wrap every call in your own retry loop.

## Cost basics and avoiding a surprise bill

AWS bills by usage, and most surprises come from four places:

- **Things left running.** An EC2 instance, a NAT gateway, an RDS database or a load balancer costs money every hour whether or not anyone uses it. A NAT gateway alone is a noticeable monthly line before any traffic.
- **Data transfer out.** Traffic leaving AWS to the internet is billed per gigabyte. Traffic between availability zones is billed too.
- **Request-priced services in a loop.** SQS, DynamoDB on-demand, Lambda and Secrets Manager API calls are cheap per call. A bug that calls them a million times a minute is not.
- **Leaked keys.** A long-lived access key pushed to a public repository is found by bots within minutes and used to mine cryptocurrency.

The defences are cheap. Set up **AWS Budgets** with an email alert at a small monthly amount the day you open an account. Turn on MFA for the root user and then stop using it. Use **tags** (`project`, `env`) on every resource so Cost Explorer can show you what each costs. Prefer serverless, pay-per-request services for side projects: an idle SQS queue or on-demand DynamoDB table costs nothing.

## Working against a local emulator

Running every experiment against a real account is slow and costs money, and it is awkward in CI. An **emulator** is a local process that answers the same HTTP APIs. The lab uses **Floci**, started with `pnpm lab up aws` and listening on `http://localhost:4566`.

Point the SDK at it with environment variables. Nothing in your code changes:

```sh
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
```

```ts
import { SQSClient, CreateQueueCommand } from '@aws-sdk/client-sqs';

// useQueueUrlAsEndpoint: false makes the SDK use AWS_ENDPOINT_URL rather than
// the host inside the returned queue URL. The emulator writes "localhost" there.
const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: 'dev-orders' }));
console.log(QueueUrl);
```

The CLI understands the same variable, so `aws sqs list-queues` works against the emulator too.

Know the limits. An emulator implements the API, not every behaviour behind it. Floci accepts any credentials and, as the lab runs it, does **not enforce IAM policies**, so a missing permission will only show up on real AWS. Throughput limits, throttling, eventual consistency and pricing are not simulated either. Use the emulator for fast feedback on your logic, and keep a staging account for the things only AWS can tell you.

In the practice tasks the checks give you `AWS_RESOURCE_PREFIX`. Start every queue, topic, table and secret name with it, so several runs can share one emulator without colliding. Real teams do the same with an environment prefix (`staging-orders`) when several environments share an account.

## Common mistakes

- Creating long-lived resources in the console and then being unable to reproduce them in staging.
- Creating a new SDK client per request, which wastes connections and slows every call.
- Matching on error messages instead of `error.name`.
- Hard-coding a region or endpoint in code instead of reading it from the environment.
- Opening an account without a budget alert, or using the root user day to day.
- Trusting the emulator on permissions: it allows everything.

## Go deeper

- [AWS shared responsibility model](https://aws.amazon.com/compliance/shared-responsibility-model/): the split between AWS and you, by service type.
- [AWS SDK for JavaScript v3 developer guide](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/welcome.html): clients, commands, credentials and configuration.
- [Amazon Resource Names](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html): the ARN format and its variations.
- [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html): setting cost and usage alerts.
- [Floci](https://github.com/floci-io/floci): the emulator used in the lab, and its list of supported services.
