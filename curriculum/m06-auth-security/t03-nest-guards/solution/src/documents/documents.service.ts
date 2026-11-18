import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../users/user.js';
import type { Document, DocumentInput } from './document.js';

/**
 * Every method takes the caller. The ownership rule lives here, next to the data,
 * so no controller (or queue worker, or GraphQL resolver) can forget it.
 */
@Injectable()
export class DocumentsService {
  private readonly documents = new Map<string, Document>();

  create(user: AuthUser, input: DocumentInput): Document {
    const doc: Document = {
      id: randomUUID(),
      ownerId: user.id, // from the token, never from the body
      title: this.text(input?.title, 'title', true) ?? '',
      body: this.text(input?.body, 'body', false) ?? '',
    };
    this.documents.set(doc.id, doc);
    return doc;
  }

  listFor(user: AuthUser): Document[] {
    return [...this.documents.values()].filter((doc) => doc.ownerId === user.id);
  }

  findFor(user: AuthUser, id: string): Document {
    const doc = this.documents.get(id);
    // 404, not 403, for someone else's document: do not confirm that the id exists.
    if (!doc || !this.canAccess(user, doc)) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  updateFor(user: AuthUser, id: string, input: DocumentInput): Document {
    const doc = this.findFor(user, id);
    const title = this.text(input?.title, 'title', false);
    const body = this.text(input?.body, 'body', false);
    const updated = { ...doc, ...(title !== undefined && { title }), ...(body !== undefined && { body }) };
    this.documents.set(id, updated);
    return updated;
  }

  removeFor(user: AuthUser, id: string): void {
    this.findFor(user, id);
    this.documents.delete(id);
  }

  private canAccess(user: AuthUser, doc: Document): boolean {
    return doc.ownerId === user.id || user.role === 'admin';
  }

  private text(value: unknown, field: string, required: boolean): string | undefined {
    if (value === undefined && !required) return undefined;
    if (typeof value !== 'string' || value.length === 0 || value.length > 1000) {
      throw new BadRequestException(`${field} must be a string of 1 to 1000 characters`);
    }
    return value;
  }
}
