import nodemailer, { type Transporter } from 'nodemailer';

/** An SMTP transport from SMTP_HOST and SMTP_PORT (Mailpit in development and in the checks). */
export function createSmtpTransport(): Transporter {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  if (!host || !Number.isInteger(port)) throw new Error('Set SMTP_HOST and SMTP_PORT');
  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
}
