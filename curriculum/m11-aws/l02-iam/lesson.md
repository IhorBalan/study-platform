---
title: "IAM: who can do what"
skills: [aws-iam]
---

Every AWS API call is a request from someone to do something to some resource. IAM (Identity and Access Management) decides whether to allow it. Get IAM right and a bug or a leaked credential does limited damage. Get it wrong and one compromised container can delete your database. This lesson covers the vocabulary, how AWS evaluates a request, how to read and write a policy, and how a workload gets credentials with no key in the code.

## Principals

A **principal** is whoever makes the request.

- The **root user** is the email address that opened the account. It can do everything and cannot be restricted by policies. Protect it with MFA and do not use it.
- An **IAM user** is a long-lived identity with a password and/or **access keys** (an access key id and a secret). Keys do not expire unless someone rotates them. New setups avoid IAM users for people (they sign in through IAM Identity Center, SSO) and for software (it uses roles).
- An **IAM role** is an identity with permissions but no permanent credentials. A trusted principal **assumes** the role and receives **temporary credentials** that expire, typically after an hour. Containers, Lambda functions, CI pipelines and humans signing in through SSO all work through roles.
- A **service principal** such as `sns.amazonaws.com` represents an AWS service acting for you, for example SNS delivering to your queue.

## Policies

A **policy** is a JSON document of statements. Each statement says: this **effect** for these **actions** on these **resources**, optionally under these **conditions**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConsumeOrderQueue",
      "Effect": "Allow",
      "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility"],
      "Resource": "arn:aws:sqs:eu-central-1:123456789012:orders"
    },
    {
      "Sid": "ReadWriteOrders",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"],
      "Resource": [
        "arn:aws:dynamodb:eu-central-1:123456789012:table/orders",
        "arn:aws:dynamodb:eu-central-1:123456789012:table/orders/index/*"
      ]
    }
  ]
}
```

`Version` is a fixed date that selects the policy language. Always write `2012-10-17`. Actions are `service:Operation`, and they match API names, so `ReceiveMessage` in the SDK is `sqs:ReceiveMessage` in the policy. A GSI is a separate resource: `table/orders` alone does not allow `Query` on its indexes.

There are two places a policy can live:

- **Identity-based policies** attach to a user, group or role and say what that identity may do.
- **Resource-based policies** attach to a resource (an SQS queue, an S3 bucket, a secret, a Lambda function) and say who may use it. They name a `Principal`. This is how SNS gets permission to send to your queue:

```json
{
  "Effect": "Allow",
  "Principal": { "Service": "sns.amazonaws.com" },
  "Action": "sqs:SendMessage",
  "Resource": "arn:aws:sqs:eu-central-1:123456789012:orders-email",
  "Condition": { "ArnEquals": { "aws:SourceArn": "arn:aws:sns:eu-central-1:123456789012:orders" } }
}
```

The condition matters: without it, any SNS topic in any account could write to the queue.

## How a request is evaluated

Within one account, the logic is short and worth knowing by heart:

1. Everything starts as **denied** (implicit deny).
2. If any applicable policy has an **explicit `Deny`** that matches, the answer is deny. Nothing can override it.
3. Otherwise, if any identity-based or resource-based policy has a matching **`Allow`**, the answer is allow.
4. Otherwise the implicit deny stands.

So: explicit deny beats allow, and allow beats the default deny. A user with `AdministratorAccess` and one statement denying `dynamodb:DeleteTable` cannot delete tables.

Other layers can only narrow this, never widen it. An organization's **service control policy** (SCP) caps what any identity in an account can do. A **permissions boundary** caps what a role can be granted. A **session policy** caps one assumed session. A request must be allowed by every layer that applies. Across accounts, both sides must allow: the caller's identity policy and the resource's policy.

When a call fails with `AccessDeniedException`, the message usually names the principal, the action and the resource. Read all three, then ask which statement should have allowed it and whether a deny or a boundary is in the way.

## Least privilege in practice

Least privilege means granting the actions and resources a workload needs and nothing else. In practice:

- **Name actions, not `*`.** `sqs:*` includes `DeleteQueue` and `PurgeQueue`. A worker needs three actions.
- **Name resources.** `"Resource": "*"` on DynamoDB actions means every table in the account, including tables created next year.
- **One role per workload.** The API and the worker have different jobs, so they get different roles. When one is compromised, the other's permissions are not exposed.
- **Use conditions where they are cheap**: `aws:SourceArn` on resource policies, `dynamodb:LeadingKeys` to restrict a role to items whose partition key matches a tenant, `kms:ViaService` for keys.
- **Start from what the code calls.** List the SDK commands your service sends; each maps to one action. Then tighten with **IAM Access Analyzer**, which can generate a policy from CloudTrail activity and flag unused permissions.

Remember that AWS managed policies such as `AmazonSQSFullAccess` are convenient and far too broad for a workload.

## Roles for workloads, not keys

The interview question "how does your service get credentials without a key in code?" has one answer: **the platform gives it a role**.

- On ECS and Fargate, the task definition names a **task role**. The container's SDK fetches temporary credentials from a local endpoint, refreshes them before they expire and never sees a long-lived secret.
- On Lambda, the function has an **execution role**.
- On EC2, an **instance profile** attaches a role to the machine.
- In GitHub Actions, the workflow exchanges its **OIDC token** for a role's credentials, so the repository holds no AWS keys at all.

A role has two policies: the **trust policy** (who may assume it, for example `ecs-tasks.amazonaws.com`) and the **permissions policy** (what it may do once assumed). A role nobody trusts is useless; a role everyone trusts is a hole.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

Because credentials are temporary, a leak expires on its own. Because the SDK's default credential chain finds them, your code stays `new DynamoDBClient({})`.

ECS has a second role, the **task execution role**, used by the ECS agent itself to pull the image and fetch the secrets injected into the container. Keep the two apart: your application code should not be able to pull arbitrary images, and the agent does not need your table.

## Common mistakes

- `"Action": "*"` or a managed `FullAccess` policy on a workload role "for now".
- Forgetting the `/index/*` resource, then wondering why `Query` on a GSI is denied.
- A queue policy for SNS without an `aws:SourceArn` condition.
- Access keys in `.env` files, container images or CI variables when a role or OIDC would do.
- One shared role for every service, so a bug anywhere has the permissions of everything.
- Trusting the local emulator to catch a missing permission. The lab emulator does not enforce policies.

## Go deeper

- [Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html): the full decision flow, including boundaries and SCPs.
- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html): AWS's own list, from temporary credentials to Access Analyzer.
- [IAM JSON policy reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies.html): every element, condition operator and global condition key.
- [IAM roles for ECS tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html): how a container receives its role's credentials.
- [Service Authorization Reference](https://docs.aws.amazon.com/service-authorization/latest/reference/reference.html): the actions, resource types and condition keys of every service.
