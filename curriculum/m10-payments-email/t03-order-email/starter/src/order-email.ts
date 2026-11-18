import type { Transporter } from 'nodemailer';
import type pg from 'pg';

export const FROM = 'Shop <orders@shop.example>';

export interface OrderItem {
  name: string;
  quantity: number;
  unitAmountMinor: number;
}

export interface OrderEmail {
  orderId: string;
  to: string;
  customerName: string;
  currency: string; // ISO code, any case
  items: OrderItem[];
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  messageId: string;
}

export type SendResult = 'sent' | 'skipped';

/** Formats an amount in minor units with the currency's own number of decimals (2 for EUR, 0 for JPY). */
export function formatMoney(amountMinor: number, currency: string): string {
  // TODO: Intl.NumberFormat('en-US', { style: 'currency', currency }) and its resolvedOptions().
  void amountMinor;
  void currency;
  throw new Error('formatMoney is not implemented yet');
}

/** Pure rendering: the same order always gives the same email. */
export function renderOrderConfirmation(order: OrderEmail): RenderedEmail {
  // TODO: subject, text and html parts and the Message-ID described in the task.
  void order;
  throw new Error('renderOrderConfirmation is not implemented yet');
}

/** Sends the confirmation for an order at most once, however often and however concurrently it is called. */
export async function sendOrderConfirmation(
  deps: { pool: pg.Pool; transport: Transporter },
  order: OrderEmail,
): Promise<SendResult> {
  // TODO: claim, send, record. A failed send must leave the order free to be retried.
  void deps;
  void order;
  throw new Error('sendOrderConfirmation is not implemented yet');
}
