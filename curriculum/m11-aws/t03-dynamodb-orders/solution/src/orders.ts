import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled';

export interface NewOrder {
  customerId: string;
  /** Time-sortable (a ULID or similar): sorting order ids sorts orders by creation time. */
  orderId: string;
  /** ISO 8601 timestamp in UTC. */
  createdAt: string;
  status: OrderStatus;
  totalCents: number;
  /** Optional expiry as Unix epoch seconds (the table's TTL attribute). */
  expiresAt?: number;
}

export interface Order extends NewOrder {
  version: number;
}

export interface Page<T> {
  items: T[];
  /** Pass back as `cursor` for the next page; null when there are no more items. */
  nextCursor: string | null;
}

export interface ListOptions {
  limit?: number;
  cursor?: string | null;
}

export class OrderExistsError extends Error {
  override name = 'OrderExistsError';
}
export class OrderNotFoundError extends Error {
  override name = 'OrderNotFoundError';
}
export class VersionConflictError extends Error {
  override name = 'VersionConflictError';
}

export interface OrderRepositoryOptions {
  client: Pick<DynamoDBDocumentClient, 'send'>;
  tableName: string;
  /** Injected so tests can control "now" for expiry. */
  now?: () => Date;
}

/*
 * Key design (one item per order):
 *
 *   pk     = CUSTOMER#<customerId>         one partition per customer
 *   sk     = ORDER#<orderId>               time-sortable ids: Query backwards = newest first
 *   gsi1pk = STATUS#<status>               orders by status, across customers
 *   gsi1sk = <createdAt>#<orderId>         oldest first; the id makes it unique
 *
 * Access patterns: get by (customer, order) is GetItem; a customer's orders is a Query on pk;
 * orders by status is a Query on gsi1. Nothing scans. gsi1pk/gsi1sk change with the status in the
 * same UpdateItem. At scale STATUS#pending would be a hot partition; sharding it
 * (STATUS#pending#0..9) is the usual fix.
 */
type Item = Order & { pk: string; sk: string; gsi1pk: string; gsi1sk: string };

const pkOf = (customerId: string) => `CUSTOMER#${customerId}`;
const skOf = (orderId: string) => `ORDER#${orderId}`;
const gsi1pkOf = (status: OrderStatus) => `STATUS#${status}`;
const gsi1skOf = (createdAt: string, orderId: string) => `${createdAt}#${orderId}`;

function toOrder(item: Record<string, unknown>): Order {
  const { customerId, orderId, createdAt, status, totalCents, version, expiresAt } = item as unknown as Item;
  const order: Order = { customerId, orderId, createdAt, status, totalCents, version };
  if (expiresAt !== undefined) order.expiresAt = expiresAt;
  return order;
}

function encodeCursor(key: Record<string, unknown> | undefined): string | null {
  return key ? Buffer.from(JSON.stringify(key)).toString('base64url') : null;
}

function decodeCursor(cursor: string | null | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const key: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (key && typeof key === 'object' && !Array.isArray(key)) return key as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new RangeError('Invalid cursor');
}

function numberAttr(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'N' in value) return Number((value as { N: string }).N);
  return undefined;
}

const isConditionFailure = (error: unknown): error is Error & { Item?: Record<string, unknown> } =>
  error instanceof Error && error.name === 'ConditionalCheckFailedException';

export class OrderRepository {
  readonly #client: Pick<DynamoDBDocumentClient, 'send'>;
  readonly #table: string;
  readonly #now: () => Date;

  constructor({ client, tableName, now = () => new Date() }: OrderRepositoryOptions) {
    this.#client = client;
    this.#table = tableName;
    this.#now = now;
  }

  #nowSeconds(): number {
    return Math.floor(this.#now().getTime() / 1000);
  }

  /** TTL deletion is lazy, so an expired item can still be read. Treat it as gone. */
  #isLive(item: Record<string, unknown>): boolean {
    return typeof item.expiresAt !== 'number' || item.expiresAt > this.#nowSeconds();
  }

  async create(input: NewOrder): Promise<Order> {
    const order: Order = { ...input, version: 1 };
    const item: Item = {
      ...order,
      pk: pkOf(input.customerId),
      sk: skOf(input.orderId),
      gsi1pk: gsi1pkOf(input.status),
      gsi1sk: gsi1skOf(input.createdAt, input.orderId),
    };
    try {
      await this.#client.send(
        new PutCommand({ TableName: this.#table, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }),
      );
    } catch (error) {
      if (isConditionFailure(error)) throw new OrderExistsError(`Order ${input.orderId} already exists`);
      throw error;
    }
    return order;
  }

  async get(customerId: string, orderId: string): Promise<Order | null> {
    const res = await this.#client.send(
      new GetCommand({ TableName: this.#table, Key: { pk: pkOf(customerId), sk: skOf(orderId) } }),
    );
    return res.Item && this.#isLive(res.Item) ? toOrder(res.Item) : null;
  }

  /** A customer's orders, newest first. */
  async listByCustomer(customerId: string, { limit = 20, cursor }: ListOptions = {}): Promise<Page<Order>> {
    return this.#page(
      {
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :order)',
        ExpressionAttributeValues: { ':pk': pkOf(customerId), ':order': 'ORDER#' },
        ScanIndexForward: false,
      },
      limit,
      cursor,
    );
  }

  /** All orders in one status, oldest first. */
  async listByStatus(status: OrderStatus, { limit = 20, cursor }: ListOptions = {}): Promise<Page<Order>> {
    return this.#page(
      {
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :status',
        ExpressionAttributeValues: { ':status': gsi1pkOf(status) },
        ScanIndexForward: true,
      },
      limit,
      cursor,
    );
  }

  async #page(
    query: { IndexName?: string; KeyConditionExpression: string; ExpressionAttributeValues: Record<string, unknown>; ScanIndexForward: boolean },
    limit: number,
    cursor: string | null | undefined,
  ): Promise<Page<Order>> {
    // Expired items are filtered after Limit is applied, so a page can hold fewer than
    // `limit` items. The cursor still moves forward correctly.
    const res = await this.#client.send(
      new QueryCommand({
        TableName: this.#table,
        ...query,
        FilterExpression: 'attribute_not_exists(expiresAt) OR expiresAt > :now',
        ExpressionAttributeValues: { ...query.ExpressionAttributeValues, ':now': this.#nowSeconds() },
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );
    const items = (res.Items ?? []).filter((item) => this.#isLive(item)).map(toOrder);
    return { items, nextCursor: encodeCursor(res.LastEvaluatedKey) };
  }

  /** Changes the status if the stored version is still `expectedVersion`. Returns the new order. */
  async updateStatus(customerId: string, orderId: string, status: OrderStatus, expectedVersion: number): Promise<Order> {
    try {
      const res = await this.#client.send(
        new UpdateCommand({
          TableName: this.#table,
          Key: { pk: pkOf(customerId), sk: skOf(orderId) },
          UpdateExpression: 'SET #status = :status, gsi1pk = :gsi1pk, version = version + :one',
          // An expired item may still be stored; it counts as gone.
          ConditionExpression: 'attribute_exists(pk) AND version = :expected AND (attribute_not_exists(expiresAt) OR expiresAt > :now)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': status,
            ':gsi1pk': gsi1pkOf(status),
            ':expected': expectedVersion,
            ':one': 1,
            ':now': this.#nowSeconds(),
          },
          ReturnValues: 'ALL_NEW',
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        }),
      );
      return toOrder(res.Attributes!);
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      // The old item comes back in DynamoDB's typed format ({ N: '2' }), even from the document client.
      const old = error.Item;
      const expiresAt = numberAttr(old?.expiresAt);
      if (!old || (expiresAt !== undefined && expiresAt <= this.#nowSeconds())) {
        throw new OrderNotFoundError(`Order ${orderId} not found`);
      }
      throw new VersionConflictError(`Order ${orderId} is at version ${numberAttr(old.version)}, not ${expectedVersion}`);
    }
  }
}
