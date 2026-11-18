import {
  CreateTableCommand,
  DeleteTableCommand,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

/**
 * The orders table. Do not change it: the checks create exactly this table.
 *
 * - Primary key: pk (string, partition key) + sk (string, sort key).
 * - One global secondary index, "gsi1": gsi1pk (partition) + gsi1sk (sort), all attributes projected.
 * - Time to Live on the number attribute "expiresAt" (Unix epoch seconds).
 *
 * You choose what goes into pk, sk, gsi1pk and gsi1sk.
 */
export async function createOrdersTable(client: DynamoDBClient, tableName: string): Promise<void> {
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
        { AttributeName: 'gsi1pk', AttributeType: 'S' },
        { AttributeName: 'gsi1sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'gsi1',
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 30, minDelay: 1 }, { TableName: tableName });
  await client.send(
    new UpdateTimeToLiveCommand({ TableName: tableName, TimeToLiveSpecification: { Enabled: true, AttributeName: 'expiresAt' } }),
  );
}

export async function deleteOrdersTable(client: DynamoDBClient, tableName: string): Promise<void> {
  await client.send(new DeleteTableCommand({ TableName: tableName }));
}
