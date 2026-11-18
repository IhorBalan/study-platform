import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../users/user.js';
import type { Document, DocumentInput } from './document.js';

@Injectable()
export class DocumentsService {
  private readonly documents = new Map<string, Document>();

  create(user: AuthUser, input: DocumentInput): Document {
    const doc: Document = {
      id: randomUUID(),
      ownerId: user.id,
      title: this.text(input?.title, 'title', true) ?? '',
      body: this.text(input?.body, 'body', false) ?? '',
    };
    this.documents.set(doc.id, doc);
    return doc;
  }

  // TODO: a member sees only their own documents.
  listFor(_user: AuthUser): Document[] {
    return [...this.documents.values()];
  }

  // TODO: this returns any document to anyone who knows its id. That is broken
  // object-level authorisation. Allow the owner and admins; everyone else gets
  // the same 404 as for an id that does not exist.
  findFor(_user: AuthUser, id: string): Document {
    const doc = this.documents.get(id);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
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

  private text(value: unknown, field: string, required: boolean): string | undefined {
    if (value === undefined && !required) return undefined;
    if (typeof value !== 'string' || value.length === 0 || value.length > 1000) {
      throw new BadRequestException(`${field} must be a string of 1 to 1000 characters`);
    }
    return value;
  }
}
