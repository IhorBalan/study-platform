import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../users/user.js';
import type { Document, DocumentInput } from './document.js';
import { DocumentsService } from './documents.service.js';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() input: DocumentInput): Document {
    return this.documents.create(user, input);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Document[] {
    return this.documents.listFor(user);
  }

  @Get(':id')
  find(@CurrentUser() user: AuthUser, @Param('id') id: string): Document {
    return this.documents.findFor(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: DocumentInput): Document {
    return this.documents.updateFor(user, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): void {
    this.documents.removeFor(user, id);
  }
}
