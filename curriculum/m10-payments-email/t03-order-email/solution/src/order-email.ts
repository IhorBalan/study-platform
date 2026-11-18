import type { Transporter } from 'nodemailer';
import type pg from 'pg';

export const FROM = 'Shop <orders@shop.example>';
const KIND = 'order_confirmation';

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
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(amountMinor / 10 ** digits);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Pure rendering: the same order always gives the same email, so a retry sends identical content. */
export function renderOrderConfirmation(order: OrderEmail): RenderedEmail {
  const totalMinor = order.items.reduce((sum, item) => sum + item.quantity * item.unitAmountMinor, 0);
  const total = formatMoney(totalMinor, order.currency);
  const lines = order.items.map((item) => ({
    label: `${item.quantity} x ${item.name}`,
    amount: formatMoney(item.quantity * item.unitAmountMinor, order.currency),
  }));

  const text = [
    `Hi ${order.customerName},`,
    '',
    `Thanks for your order ${order.orderId}.`,
    '',
    ...lines.map((l) => `${l.label}: ${l.amount}`),
    '',
    `Total: ${total}`,
    '',
  ].join('\n');

  const html = [
    '<!doctype html><html><body>',
    `<p>Hi ${escapeHtml(order.customerName)},</p>`,
    `<p>Thanks for your order ${escapeHtml(order.orderId)}.</p>`,
    '<table>',
    ...lines.map((l) => `<tr><td>${escapeHtml(l.label)}</td><td>${escapeHtml(l.amount)}</td></tr>`),
    `<tr><td><strong>Total</strong></td><td><strong>${escapeHtml(total)}</strong></td></tr>`,
    '</table>',
    '</body></html>',
  ].join('\n');

  return {
    subject: `Order ${order.orderId} confirmed`,
    text,
    html,
    messageId: `<order-confirmation-${order.orderId}@shop.example>`,
  };
}

/**
 * Sends the confirmation for an order at most once, however often it is called.
 *
 * Claim (insert, one statement) -> send (no transaction open) -> mark sent. If sending fails the claim is
 * removed so a retry can send. The remaining gap: SMTP accepted the message and the process died before
 * "mark sent". The claim then stays 'sending' and nobody sends again; a sweeper would have to decide.
 */
export async function sendOrderConfirmation(
  deps: { pool: pg.Pool; transport: Transporter },
  order: OrderEmail,
): Promise<SendResult> {
  const { pool, transport } = deps;
  const claim = await pool.query(
    `insert into email_log (kind, ref, status) values ($1, $2, 'sending') on conflict do nothing`,
    [KIND, order.orderId],
  );
  if (claim.rowCount === 0) return 'skipped';

  const email = renderOrderConfirmation(order);
  try {
    const info = await transport.sendMail({
      from: FROM,
      to: order.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      messageId: email.messageId,
    });
    await pool.query(
      `update email_log set status = 'sent', message_id = $3, updated_at = now() where kind = $1 and ref = $2`,
      [KIND, order.orderId, info.messageId ?? email.messageId],
    );
    return 'sent';
  } catch (error) {
    await pool.query(`delete from email_log where kind = $1 and ref = $2 and status = 'sending'`, [KIND, order.orderId]);
    throw error;
  }
}
