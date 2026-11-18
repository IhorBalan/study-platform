import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { AuthUser } from '../auth/user.js';
import { type CreateInvoice, CreateInvoiceSchema } from './invoices.schemas.js';
import { type Invoice, InvoicesService } from './invoices.service.js';

@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post('invoices')
  create(@CurrentUser() user: AuthUser, @Body({ schema: CreateInvoiceSchema }) input: CreateInvoice): Promise<Invoice> {
    return this.invoices.create(user, input);
  }

  @Get('invoices')
  list(@CurrentUser() user: AuthUser, @Query('search') search?: unknown, @Query('sort') sort?: unknown): Promise<Invoice[]> {
    return this.invoices.listFor(user, search, sort);
  }

  @Get('invoices/:id')
  find(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<Invoice> {
    return this.invoices.findFor(user, id);
  }

  @Delete('invoices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.invoices.removeFor(user, id);
  }

  @Roles(['admin'])
  @Get('admin/invoices')
  listAll(): Promise<Invoice[]> {
    return this.invoices.listAll();
  }
}
