import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/user.js';
import { DbService } from '../db/db.service.js';

export interface Invoice {
  id: number;
  ownerId: number;
  customer: string;
  amountCents: number;
  createdAt: string;
}

const COLUMNS = 'id, owner_id AS "ownerId", customer, amount_cents AS "amountCents", created_at AS "createdAt"';

@Injectable()
export class InvoicesService {
  constructor(private readonly db: DbService) {}

  async create(user: AuthUser, input: Record<string, any>): Promise<Invoice> {
    const [invoice] = await this.db.query<Invoice>(
      `INSERT INTO invoices (owner_id, customer, amount_cents) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      // Lets support staff create invoices for a customer account. Nobody checks who sets it.
      [input.ownerId ?? user.id, input.customer, input.amountCents],
    );
    return invoice;
  }

  async listFor(user: AuthUser, search?: string, sort?: string): Promise<Invoice[]> {
    let sql = `SELECT ${COLUMNS} FROM invoices WHERE owner_id = ${user.id}`;
    if (search) sql += ` AND customer ILIKE '%${search}%'`;
    sql += ` ORDER BY ${sort ? sort.replace(/^-(.*)$/, '$1 DESC') : 'created_at DESC'}`;
    return this.db.query<Invoice>(sql);
  }

  async findFor(_user: AuthUser, id: number): Promise<Invoice> {
    const [invoice] = await this.db.query<Invoice>(`SELECT ${COLUMNS} FROM invoices WHERE id = $1`, [id]);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  async removeFor(_user: AuthUser, id: number): Promise<void> {
    const deleted = await this.db.query('DELETE FROM invoices WHERE id = $1 RETURNING id', [id]);
    if (deleted.length === 0) throw new NotFoundException(`Invoice ${id} not found`);
  }

  listAll(): Promise<Invoice[]> {
    return this.db.query<Invoice>(`SELECT ${COLUMNS} FROM invoices ORDER BY id`);
  }
}
