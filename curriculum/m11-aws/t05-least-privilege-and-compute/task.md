Your team is moving the orders backend to AWS. Write the IAM policy for one worker and decide where three workloads run. Write 500 to 900 words plus the policy JSON.

## The fulfilment worker

The worker runs as a container on ECS Fargate in `eu-central-1`, account `111122223333`. In a loop it:

1. long-polls the SQS queue `prod-order-paid` (receives messages, extends their visibility while working, deletes them on success, sets a retry delay on failure);
2. reads and updates the order in the DynamoDB table `prod-orders` (get one order, create a shipment item, conditional update of the status) and queries the table's index `by-status`;
3. at start-up, reads its configuration from the SSM parameter tree `/prod/fulfilment/` (some values are SecureStrings encrypted with the customer managed KMS key `arn:aws:kms:eu-central-1:111122223333:key/0d9c3a5e-1111-4a2b-9c3d-123456789abc`) and the warehouse API key from the Secrets Manager secret `prod/fulfilment/warehouse-api`;
4. publishes an `order.shipped` event to the SNS topic `prod-order-events`.

It never creates, deletes or reconfigures any of these resources.

## What to write

1. **The permissions policy** for the worker's role, as JSON, with a `Sid` per statement.
2. **How the worker gets credentials.** Which role, its trust policy (JSON), and why no access key is needed anywhere.
3. **An incident question.** After an incident, security asks you to guarantee that this role can never delete the `prod-orders` table, even if someone later attaches a broad policy to it by mistake. How do you guarantee it, and why does that work given how AWS evaluates a request? Name one guard rail outside the role itself.
4. **Verification.** How would you find a missing or unnecessary permission before or after deploying? The lab's emulator accepted every call during development: why is that not evidence?
5. **Where each job runs.** Choose Lambda, ECS on Fargate or EC2 for each, with your reasoning:
   - the orders REST API (NestJS, Postgres connection pool, steady traffic of 30 to 80 requests per second);
   - creating three thumbnail sizes after each product image upload (a few hundred per day, in bursts, about 2 seconds each);
   - a nightly export of all orders to a partner's SFTP server (about 40 minutes).

   For each, name one cost or risk of your choice and one fact that would change your mind.

## What is assessed

Whether the policy grants exactly what the worker needs on concrete resources, whether the credential and evaluation answers are correct, and whether each compute choice follows from the workload's duration, load and trigger. There are no automated checks.
