import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';
import { withImapClient } from '../imap/client.js';
import { ImapServiceError } from '../imap/errors.js';
import { MAX_ATTACHMENT_BYTES } from '../imap/mime.js';
import { decryptSecret } from '../security/crypto.js';
import { getAccountCredentials } from '../storage/repository.js';

const MAX_RECIPIENTS = 100;
const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_BODY_CHARS = 100_000;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

export interface SendEmailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; contentType?: string; contentBase64: string }>;
}

export interface SendEmailResult {
  messageId: string;
  sent: true;
  archived: boolean;
  rejectedRecipients?: number;
  archiveError?: string;
}

interface CompiledMessage { build(): Promise<Buffer> }
interface MailComposerInstance { compile(): CompiledMessage }
type MailComposerConstructor = new (options: Record<string, unknown>) => MailComposerInstance;
const require = createRequire(__filename);
const MailComposer = require('nodemailer/lib/mail-composer') as MailComposerConstructor;

let serviceConfig: AppConfig | undefined;

/** Stores the SMTP settings used by later message sends. */
export function configureSmtpService(config: AppConfig): void {
  serviceConfig = config;
}

/** Throws the shared safe validation error for invalid outbound message input. */
function invalidInput(): never { throw new ImapServiceError('INVALID_INPUT'); }

/** Accepts only a single plain email address, excluding header and list syntax. */
function validateAddress(address: string): void {
  if (typeof address !== 'string' || address.length > 320 || /[\s<>(),;\r\n\0]/.test(address) ||
      !/^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(address)) invalidInput();
}

/** Validates recipient, body, and attachment limits before any network operation. */
function validateMessage(input: SendEmailInput): void {
  if (!input || typeof input !== 'object' || !Array.isArray(input.to) || input.to.length < 1 ||
      !Array.isArray(input.cc ?? []) || !Array.isArray(input.bcc ?? [])) invalidInput();
  const recipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
  if (recipients.length > MAX_RECIPIENTS) invalidInput();
  recipients.forEach(validateAddress);
  if (typeof input.subject !== 'string' || input.subject.length > 998 || /[\r\n\0]/.test(input.subject) ||
      (input.text === undefined && input.html === undefined) ||
      (input.text !== undefined && (typeof input.text !== 'string' || input.text.length > MAX_BODY_CHARS)) ||
      (input.html !== undefined && (typeof input.html !== 'string' || input.html.length > MAX_BODY_CHARS))) invalidInput();

  const attachments = input.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) invalidInput();
  let totalBytes = 0;
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object' || typeof attachment.filename !== 'string' ||
        !attachment.filename.trim() || attachment.filename.length > 255 || /[\r\n\0/\\]/.test(attachment.filename) ||
        typeof attachment.contentBase64 !== 'string' || !attachment.contentBase64 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.contentBase64)) invalidInput();
    if (attachment.contentType !== undefined && (typeof attachment.contentType !== 'string' ||
        attachment.contentType.length > 255 || !/^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w.+-]+=[\w.+-]+)*$/.test(attachment.contentType))) invalidInput();
    const content = Buffer.from(attachment.contentBase64, 'base64');
    if (content.toString('base64') !== attachment.contentBase64 || content.length > MAX_ATTACHMENT_BYTES) invalidInput();
    totalBytes += content.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) invalidInput();
  }
}

/** Normalizes an optional mailbox name and rejects unsafe command characters. */
function mailboxName(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  const name = value.trim();
  if (name.length > 1024 || /[\r\n\0]/.test(name)) invalidInput();
  return name;
}

/** Selects the configured Sent folder or the mailbox advertised with the Sent role. */
function resolveFromList(mailboxes: Array<{ path: string; specialUse?: string | null }>, override?: string): string {
  const configured = mailboxName(override);
  if (configured) {
    const match = mailboxes.find((mailbox) => mailbox.path === configured);
    if (match) return match.path;
    throw new ImapServiceError('NOT_FOUND', 'The configured Sent mailbox is not available.');
  }
  const sent = mailboxes.find((mailbox) => mailbox.specialUse?.toLowerCase() === '\\sent');
  if (sent) return sent.path;
  throw new ImapServiceError('NOT_FOUND', 'No Sent mailbox is available for this account.');
}

/** Resolves a Sent mailbox using the account's current IMAP connection. */
export async function resolveSentMailbox(accountId: string, override?: string): Promise<string> {
  if (!accountId) invalidInput();
  const configuredOverride = override ?? serviceConfig?.sentFolder;
  return withImapClient(accountId, async (client) => resolveFromList(await client.list(), configuredOverride));
}

/** Converts SMTP failures into safe service errors without exposing server details. */
function safeSmtpError(error: unknown): ImapServiceError {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = String(details.code ?? '').toLowerCase();
  if (code === 'eauth' || code.includes('auth')) return new ImapServiceError('AUTHENTICATION');
  if (code.includes('timeout')) return new ImapServiceError('TIMEOUT');
  if (code.includes('tls') || code.includes('certificate')) return new ImapServiceError('CONNECTION');
  return new ImapServiceError('CONNECTION', 'The SMTP server could not confirm acceptance. Check delivery before retrying.');
}

/** Creates a unique Message-ID using only a validated domain from the username. */
function createMessageId(username: string): string {
  const domain = username.split('@').at(-1);
  const safeDomain = domain && /^[A-Za-z0-9.-]{1,253}$/.test(domain) ? domain : 'localhost';
  return `<${randomUUID()}@${safeDomain}>`;
}

/** Sends one validated message and archives the exact accepted bytes in Sent. */
export async function sendAndArchive(accountId: string, input: SendEmailInput): Promise<SendEmailResult> {
  if (!serviceConfig?.smtp) throw new ImapServiceError('UNSUPPORTED', 'Email sending is not enabled on this server.');
  if (typeof accountId !== 'string' || !accountId) invalidInput();
  validateMessage(input);

  const credentials = getAccountCredentials(accountId);
  if (!credentials) throw new ImapServiceError('AUTHENTICATION');
  let password: string;
  try { password = decryptSecret(credentials.encryptedPassword, serviceConfig.encryptionKey); }
  catch { throw new ImapServiceError('INTERNAL'); }

  return withImapClient(accountId, async (client) => {
    // Resolve and verify Sent before creating an SMTP connection. A missing folder
    // must never result in a delivered message that cannot be archived.
    const sentFolder = resolveFromList(await client.list(), serviceConfig?.sentFolder);
    const messageId = createMessageId(credentials.username);
    const envelope = {
      from: credentials.username,
      to: [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])],
    };
    const rawMessage = await new MailComposer({
      from: credentials.username,
      to: input.to,
      ...(input.cc?.length ? { cc: input.cc } : {}),
      ...(input.bcc?.length ? { bcc: input.bcc } : {}),
      subject: input.subject,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.html !== undefined ? { html: input.html } : {}),
      ...(input.attachments?.length ? {
        attachments: input.attachments.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType ?? 'application/octet-stream',
          content: Buffer.from(attachment.contentBase64, 'base64'),
          contentTransferEncoding: 'base64',
        })),
      } : {}),
      messageId,
      envelope,
      disableFileAccess: true,
      disableUrlAccess: true,
    }).compile().build();
    if (rawMessage.length > MAX_MESSAGE_BYTES) throw new ImapServiceError('TOO_LARGE');

    const smtp = serviceConfig!.smtp!;
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.tlsMode === 'implicit',
      ...(smtp.tlsMode === 'starttls' ? { requireTLS: true } : {}),
      tls: { rejectUnauthorized: true },
      auth: { user: credentials.username, pass: password },
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
      maxRecipients: MAX_RECIPIENTS,
    });
    let rejectedRecipients = 0;
    try {
      const info = await transporter.sendMail({
        raw: rawMessage,
        envelope,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const accepted = Array.isArray(info.accepted) && info.accepted.length > 0;
      if (!accepted) throw new ImapServiceError('CONNECTION', 'The SMTP server did not accept the message.');
      rejectedRecipients = Array.isArray(info.rejected) ? info.rejected.length : 0;
    } catch (error) {
      throw error instanceof ImapServiceError ? error : safeSmtpError(error);
    } finally {
      transporter.close();
    }

    // SMTP has accepted the message. From here on, failures are partial success;
    // never attempt a second SMTP transaction as an archival recovery strategy.
    try {
      await client.append(sentFolder, rawMessage, ['\\Seen']);
      return { messageId, sent: true, archived: true, rejectedRecipients };
    } catch {
      return {
        messageId,
        sent: true,
        archived: false,
        rejectedRecipients,
        archiveError: 'The message was sent, but could not be archived in Sent.',
      };
    }
  });
}
