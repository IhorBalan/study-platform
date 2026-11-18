import type { Transporter } from 'nodemailer';

/** An SMTP transport from SMTP_HOST and SMTP_PORT (Mailpit in development and in the checks). */
export function createSmtpTransport(): Transporter {
  // TODO: nodemailer.createTransport with host and port from the environment. Mailpit needs no auth or TLS.
  throw new Error('createSmtpTransport is not implemented yet');
}
