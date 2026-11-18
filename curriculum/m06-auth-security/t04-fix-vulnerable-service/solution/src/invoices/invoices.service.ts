import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/user.js';
import { DbService } from '../db/db.service.js';
import type { CreateInvoice } from './invoices.schemas.js';

export interface Invoice {
  id: number;
  ownerId: number;
  customer: string;
  amountCents: number;
  createdAt: string;
}

const COLUMNS = 'id, owner_id AS "ownerId", customer, amount_cents AS "amountCents", created_at AS "createdAt"';

/**
 * Identifiers (column names, sort direction) cannot be bound as parameters, so
 * the client picks a key and the SQL text comes from this fixed map.
 */
const SORTS: Record<string, string> = {
  created_at: 'created_at ASC, id ASC',
  '-created_at': 'created_at DESC, id DESC',
  amount_cents: 'amount_cents ASC, id ASC',
  '-amount_cents': 'amount_cents DESC, id DESC',
  customer: 'customer ASC, id ASC',
  '-customer': 'customer DESC, id DESC',
};

/** LIKE treats % and _ as wildcards. Escape them so a search for "50%" means the text "50%". */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class InvoicesService {
  constructor(private readonly db: DbService) {}

  async create(user: AuthUser, input: CreateInvoice): Promise<Invoice> {
    const [invoice] = await this.db.query<Invoice>(
      `INSERT INTO invoices (owner_id, customer, amount_cents) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [user.id, input.customer, input.amountCents],
    );
    return invoice;
  }

  async listFor(user: AuthUser, search: unknown, sort: unknown): Promise<Invoice[]> {
    const sortKey = sort === undefined ? '-created_at' : sort;
    if (typeof sortKey !== 'string' || !Object.hasOwn(SORTS, sortKey)) {
      throw new BadRequestException(`sort must be one of: ${Object.keys(SORTS).join(', ')}`);
    }
    if (search !== undefined && (typeof search !== 'string' || search.length > 100)) {
      throw new BadRequestException('search must be a string of at most 100 characters');
    }
    return this.db.query<Invoice>(
      `SELECT ${COLUMNS} FROM invoices
        WHERE owner_id = $1 AND customer ILIKE '%' || $2 || '%'
        ORDER BY ${SORTS[sortKey]}`,
      [user.id, escapeLike(search ?? '')],
    );
  }

  /** The owner filter is part of the query, so another user's invoice simply is not found. */
  async findFor(user: AuthUser, id: number): Promise<Invoice> {
    const [invoice] = await this.db.query<Invoice>(`SELECT ${COLUMNS} FROM invoices WHERE id = $1 AND owner_id = $2`, [
      id,
      user.id,
    ]);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  async removeFor(user: AuthUser, id: number): Promise<void> {
    const deleted = await this.db.query('DELETE FROM invoices WHERE id = $1 AND owner_id = $2 RETURNING id', [id, user.id]);
    if (deleted.length === 0) throw new NotFoundException(`Invoice ${id} not found`);
  }

  listAll(): Promise<Invoice[]> {
    return this.db.query<Invoice>(`SELECT ${COLUMNS} FROM invoices ORDER BY id`);
  }
}
