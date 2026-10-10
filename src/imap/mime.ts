import { simpleParser } from 'mailparser';
import type { ImapFlow } from 'imapflow';
import { ImapServiceError } from './errors.js';

export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_TEXT_LENGTH = 100_000;
const MAX_ATTACHMENTS = 50;
export interface MessageContent {
  uid: number; subject: string | null; from: string[]; to: string[]; cc: string[]; date: string | null;
  text: string; html: string | null; truncated: boolean;
  attachments: Array<{ partId: string; filename: string; contentType: string; size: number }>;
}
function addresses(value: { value?: Array<{ name?: string; address?: string }> } | Array<{ value?: Array<{ name?: string; address?: string }> }> | undefined): string[] {
  const groups = Array.isArray(value) ? value : value ? [value] : [];
  return groups.flatMap((group) => group.value ?? []).slice(0, 50).map((item) => (item.name ? `${item.name} <${item.address ?? ''}>` : item.address ?? '').slice(0, 512));
}
export async function parseMessage(uid: number, source: Buffer, partIds: string[] = []): Promise<MessageContent> {
  if (!Buffer.isBuffer(source) || source.length > MAX_MESSAGE_BYTES) throw new ImapServiceError('TOO_LARGE');
  try {
    const parsed = await simpleParser(source);
    const text = (parsed.text ?? '').slice(0, MAX_TEXT_LENGTH);
    const htmlSource = typeof parsed.html === 'string' ? parsed.html : null;
    return {
      uid, subject: parsed.subject?.slice(0, 2000) ?? null, from: addresses(parsed.from), to: addresses(parsed.to), cc: addresses(parsed.cc),
      date: parsed.date?.toISOString() ?? null, text, html: htmlSource?.slice(0, MAX_TEXT_LENGTH) ?? null,
      truncated: text.length < (parsed.text?.length ?? 0) || (htmlSource?.length ?? 0) > MAX_TEXT_LENGTH,
      attachments: parsed.attachments.slice(0, MAX_ATTACHMENTS).map((attachment, index) => ({
        partId: partIds[index] ?? String(index + 1), filename: (attachment.filename ?? 'attachment').slice(0, 255),
        contentType: attachment.contentType.slice(0, 255), size: attachment.size,
      })),
    };
  } catch { throw new ImapServiceError('CONNECTION', 'The message content could not be parsed.'); }
}
export async function downloadAttachment(client: ImapFlow, uid: number, partId: string): Promise<{ filename: string | null; contentType: string; contentBase64: string }> {
  if (!Number.isSafeInteger(uid) || uid < 1 || typeof partId !== 'string' || !/^\d+(?:\.\d+)*$/.test(partId)) throw new ImapServiceError('INVALID_INPUT');
  const { meta, content } = await client.download(uid, partId, { uid: true, maxBytes: MAX_ATTACHMENT_BYTES + 1 });
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of content) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += data.length;
    if (size > MAX_ATTACHMENT_BYTES) { content.destroy(); throw new ImapServiceError('TOO_LARGE'); }
    chunks.push(data);
  }
  return { filename: meta.filename?.slice(0, 255) ?? null, contentType: meta.contentType.slice(0, 255), contentBase64: Buffer.concat(chunks, size).toString('base64') };
}
