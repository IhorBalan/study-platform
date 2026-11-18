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
 * TODO: your key design. For each access pattern, write down which key serves it:
 *
 *   get one order            ->
 *   a customer's orders      ->
 *   all orders in a status   ->
 *
 *   pk     =
 *   sk     =
 *   gsi1pk =
 *   gsi1sk =
 */

export class OrderRepository {
  readonly #client: Pick<DynamoDBDocumentClient, 'send'>;
  readonly #table: string;
  readonly #now: () => Date;

  constructor({ client, tableName, now = () => new Date() }: OrderRepositoryOptions) {
    this.#client = client;
    this.#table = tableName;
    this.#now = now;
  }

  /** Stores a new order at version 1. Throws OrderExistsError if it exists. */
  async create(input: NewOrder): Promise<Order> {
    // TODO: PutCommand with a condition, so an existing order is never overwritten.
    throw new Error(`TODO: create ${input.orderId} in ${this.#table}`);
  }

  /** The order, or null when it does not exist or has expired. */
  async get(customerId: string, orderId: string): Promise<Order | null> {
    // TODO: GetCommand, then map the item back to an Order (no pk, sk, ...).
    void this.#client;
    void this.#now;
    throw new Error(`TODO: get ${customerId}/${orderId}`);
  }

  /** A customer's orders, newest first. */
  async listByCustomer(customerId: string, options: ListOptions = {}): Promise<Page<Order>> {
    // TODO: Query, Limit, ExclusiveStartKey from the cursor, LastEvaluatedKey to the next cursor.
    throw new Error(`TODO: list ${customerId} ${JSON.stringify(options)}`);
  }

  /** All orders in one status, oldest first. */
  async listByStatus(status: OrderStatus, options: ListOptions = {}): Promise<Page<Order>> {
    // TODO: Query the gsi1 index.
    throw new Error(`TODO: list ${status} ${JSON.stringify(options)}`);
  }

  /** Changes the status if the stored version is still expectedVersion. Returns the new order. */
  async updateStatus(customerId: string, orderId: string, status: OrderStatus, expectedVersion: number): Promise<Order> {
    // TODO: UpdateCommand with a condition on the version; keep the index keys in step with the status.
    throw new Error(`TODO: update ${customerId}/${orderId} to ${status} at ${expectedVersion}`);
  }
}
