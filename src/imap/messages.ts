import type { ImapFlow } from 'imapflow';
import { withImapClient } from './client.js';
import { findTrashMailbox } from './mailboxes.js';
import { downloadAttachment, MAX_MESSAGE_BYTES, parseMessage, type MessageContent } from './mime.js';
import { ImapServiceError, safely } from './errors.js';

export interface MessagePage { limit: number; beforeUid?: number }
export interface SearchCriteria { from?: string; to?: string; subject?: string; text?: string; since?: string; before?: string; unreadOnly?: boolean; flaggedOnly?: boolean }
export interface MessageFlags { seen?: boolean; flagged?: boolean }
export interface MessageSummary { uid: number; subject: string | null; from: string[]; to: string[]; date: string | null; flags: string[]; size: number | null }
const UID_SEARCH_CHUNK = 500;

function validMailbox(mailbox: string): void {
  if (typeof mailbox !== 'string' || !mailbox.trim() || mailbox.length > 1024 || /[\r\n\0]/.test(mailbox)) throw new ImapServiceError('INVALID_INPUT');
}
function validUid(uid: number): void { if (!Number.isSafeInteger(uid) || uid < 1) throw new ImapServiceError('INVALID_INPUT'); }
function validPage(page: MessagePage): void {
  if (!page || !Number.isInteger(page.limit) || page.limit < 1 || page.limit > 50 ||
      (page.beforeUid !== undefined && (!Number.isSafeInteger(page.beforeUid) || page.beforeUid < 1))) throw new ImapServiceError('INVALID_INPUT');
}
function dateValue(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new ImapServiceError('INVALID_INPUT');
  return new Date(value);
}
function searchQuery(criteria: SearchCriteria): Record<string, unknown> {
  if (!criteria || typeof criteria !== 'object') throw new ImapServiceError('INVALID_INPUT');
  const query: Record<string, unknown> = {};
  for (const key of ['from', 'to', 'subject', 'text'] as const) {
    const value = criteria[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\r\n\0]/.test(value)) throw new ImapServiceError('INVALID_INPUT');
      query[key === 'text' ? 'text' : key] = value.trim();
    }
  }
  const since = dateValue(criteria.since); const before = dateValue(criteria.before);
  if (since) query.since = since;
  if (before) query.before = before;
  if (criteria.unreadOnly !== undefined) {
    if (typeof criteria.unreadOnly !== 'boolean') throw new ImapServiceError('INVALID_INPUT');
    if (criteria.unreadOnly) query.seen = false;
  }
  if (criteria.flaggedOnly !== undefined) {
    if (typeof criteria.flaggedOnly !== 'boolean') throw new ImapServiceError('INVALID_INPUT');
    if (criteria.flaggedOnly) query.flagged = true;
  }
  if (!Object.keys(query).length) query.all = true;
  return query;
}
async function locked<T>(client: ImapFlow, mailbox: string, action: () => Promise<T>): Promise<T> {
  const lock = await client.getMailboxLock(mailbox);
  try { return await action(); } finally { lock.release(); }
}
function summary(message: { uid: number; envelope?: { subject?: string | null; from?: Array<{ name?: string; address?: string }>; to?: Array<{ name?: string; address?: string }>; date?: Date | null }; flags?: Set<string>; size?: number }): MessageSummary {
  const formatAddresses = (items?: Array<{ name?: string; address?: string }>): string[] => (items ?? []).slice(0, 25).map((item) => (item.name ? `${item.name} <${item.address ?? ''}>` : item.address ?? '').slice(0, 512));
  return { uid: message.uid, subject: message.envelope?.subject?.slice(0, 2000) ?? null,
    from: formatAddresses(message.envelope?.from), to: formatAddresses(message.envelope?.to),
    date: message.envelope?.date instanceof Date ? message.envelope.date.toISOString() : null,
    flags: [...(message.flags ?? [])].slice(0, 50).map((flag) => flag.slice(0, 100)), size: message.size ?? null };
}
async function pageMessages(client: ImapFlow, mailbox: string, query: Record<string, unknown>, page: MessagePage): Promise<MessageSummary[]> {
  return locked(client, mailbox, async () => {
    // Walk newest-to-oldest in fixed UID windows. The server returns at most
    // one window of UIDs per SEARCH, even when the mailbox contains millions.
    let newestUid = (client.mailbox?.uidNext ?? 1) - 1;
    if (page.beforeUid !== undefined) newestUid = Math.min(newestUid, page.beforeUid - 1);
    const uids: number[] = [];
    while (newestUid >= 1 && uids.length < page.limit) {
      const lowUid = Math.max(1, newestUid - UID_SEARCH_CHUNK + 1);
      const result = await client.search({ ...query, uid: `${lowUid}:${newestUid}` } as never, { uid: true });
      if (Array.isArray(result)) {
        const matches = result.filter((uid) => Number.isSafeInteger(uid) && uid >= lowUid && uid <= newestUid).sort((a, b) => b - a);
        uids.push(...matches.slice(0, page.limit - uids.length));
      }
      newestUid = lowUid - 1;
    }
    if (!uids.length) return [];
    const messages = await client.fetchAll(uids, { uid: true, envelope: true, flags: true, size: true, internalDate: true }, { uid: true });
    return messages.map(summary).sort((left, right) => right.uid - left.uid);
  });
}

export async function listMessages(accountId: string, mailbox: string, page: MessagePage): Promise<MessageSummary[]> {
  validMailbox(mailbox); validPage(page);
  return safely(() => withImapClient(accountId, (client) => pageMessages(client, mailbox, { all: true }, page)));
}
export async function searchMessages(accountId: string, mailbox: string, criteria: SearchCriteria, page: MessagePage): Promise<MessageSummary[]> {
  validMailbox(mailbox); validPage(page); const query = searchQuery(criteria);
  return safely(() => withImapClient(accountId, (client) => pageMessages(client, mailbox, query, page)));
}
export async function readMessage(accountId: string, mailbox: string, uid: number): Promise<MessageContent> {
  validMailbox(mailbox); validUid(uid);
  return safely(() => withImapClient(accountId, async (client) => locked(client, mailbox, async () => {
    const message = await client.fetchOne(String(uid), { uid: true, source: { start: 0, maxLength: MAX_MESSAGE_BYTES }, size: true, bodyStructure: true }, { uid: true });
    if (!message?.source) throw new ImapServiceError('NOT_FOUND');
    const partIds: string[] = [];
    const collectParts = (node: typeof message.bodyStructure): void => {
      if (!node) return;
      const majorType = node.type?.split('/')[0]?.toLowerCase();
      if (node.disposition?.toLowerCase() === 'attachment' || (majorType && majorType !== 'text' && majorType !== 'multipart' && !node.disposition)) {
        partIds.push(node.part ?? '1');
      }
      for (const child of node.childNodes ?? []) collectParts(child);
    };
    collectParts(message.bodyStructure);
    const parsed = await parseMessage(uid, message.source, partIds);
    if ((message.size ?? 0) > MAX_MESSAGE_BYTES) parsed.truncated = true;
    return parsed;
  })));
}
export async function getAttachment(accountId: string, mailbox: string, uid: number, partId: string): Promise<{ filename: string | null; contentType: string; contentBase64: string }> {
  validMailbox(mailbox); validUid(uid);
  return safely(() => withImapClient(accountId, async (client) => locked(client, mailbox, () => downloadAttachment(client, uid, partId))));
}
export async function setMessageFlags(accountId: string, mailbox: string, uid: number, flags: MessageFlags): Promise<void> {
  validMailbox(mailbox); validUid(uid);
  if (!flags || typeof flags !== 'object' || (!('seen' in flags) && !('flagged' in flags)) ||
      (flags.seen !== undefined && typeof flags.seen !== 'boolean') || (flags.flagged !== undefined && typeof flags.flagged !== 'boolean')) throw new ImapServiceError('INVALID_INPUT');
  return safely(() => withImapClient(accountId, async (client) => locked(client, mailbox, async () => {
    for (const [key, flag] of [['seen', '\\Seen'], ['flagged', '\\Flagged']] as const) {
      if (flags[key] === true) await client.messageFlagsAdd(String(uid), [flag], { uid: true });
      if (flags[key] === false) await client.messageFlagsRemove(String(uid), [flag], { uid: true });
    }
  })));
}
export async function copyMessage(accountId: string, mailbox: string, uid: number, destination: string): Promise<void> {
  validMailbox(mailbox); validMailbox(destination); validUid(uid);
  return safely(() => withImapClient(accountId, (client) => locked(client, mailbox, async () => { await client.messageCopy(String(uid), destination, { uid: true }); })));
}
export async function moveMessage(accountId: string, mailbox: string, uid: number, destination: string): Promise<void> {
  validMailbox(mailbox); validMailbox(destination); validUid(uid);
  return safely(() => withImapClient(accountId, (client) => locked(client, mailbox, async () => { await client.messageMove(String(uid), destination, { uid: true }); })));
}
export async function deleteMessage(accountId: string, mailbox: string, uid: number): Promise<void> {
  validMailbox(mailbox); validUid(uid);
  return safely(() => withImapClient(accountId, async (client) => locked(client, mailbox, async () => {
    const trash = await findTrashMailbox(client);
    if (trash) await client.messageMove(String(uid), trash, { uid: true });
    else await client.messageFlagsAdd(String(uid), ['\\Deleted'], { uid: true });
  })));
}
export async function expungeMessages(accountId: string, mailbox: string): Promise<void> {
  validMailbox(mailbox);
  return safely(() => withImapClient(accountId, async (client) => locked(client, mailbox, async () => { await client.mailboxClose(); })));
}
