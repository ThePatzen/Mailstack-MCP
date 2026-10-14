import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';

export async function sendManagementLoginCode(
  config: Pick<AppConfig, 'smtp' | 'systemMail'>,
  recipient: string,
  code: string,
  expiresAt: number,
): Promise<void> {
  if (!config.smtp || !config.systemMail) throw new Error('System mail is not configured.');
  if (typeof recipient !== 'string' || recipient.length > 320 || /[\s<>(),;\r\n\0]/.test(recipient) ||
      !/^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(recipient) || !/^[0-9]{6}$/.test(code) ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Invalid system-mail input.');
  }
  const { smtp, systemMail } = config;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.tlsMode === 'implicit',
    ...(smtp.tlsMode === 'starttls' ? { requireTLS: true } : {}),
    tls: { rejectUnauthorized: true },
    auth: { user: systemMail.user, pass: systemMail.password },
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
    maxRecipients: 1,
  });
  try {
    const info = await transporter.sendMail({
      from: systemMail.from,
      to: { address: recipient, name: '' },
      subject: 'Ihr Anmeldecode für Mailstack MCP',
      text: `Ihr Anmeldecode für Mailstack MCP lautet: ${code}\n\n` +
        `Der Code ist einmalig verwendbar und bis ${new Date(expiresAt).toISOString()} (UTC) gültig.\n\n` +
        'Falls Sie diese Anmeldung nicht angefordert haben, ignorieren Sie diese Nachricht.',
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (!Array.isArray(info.accepted) || info.accepted.length === 0) {
      throw new Error('The SMTP server did not accept the system message.');
    }
  } finally {
    transporter.close();
  }
}
