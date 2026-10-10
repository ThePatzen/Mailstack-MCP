import type { ImapFlow } from 'imapflow';
import { withImapClient } from './client.js';
import { ImapServiceError, safely } from './errors.js';

const MAX_MAILBOXES = 500;
const MAX_NAME_LENGTH = 1024;
export interface MailboxSummary { path: string; name: string; delimiter: string | false; specialUse: string | null; flags: string[] }

function validName(name: string): void {
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LENGTH || /[\r\n\0]/.test(name)) throw new ImapServiceError('INVALID_INPUT');
}
function summary(mailbox: { path: string; name: string; delimiter: string | false; specialUse?: string | null; flags?: Set<string> }): MailboxSummary {
  return { path: mailbox.path.slice(0, MAX_NAME_LENGTH), name: mailbox.name.slice(0, MAX_NAME_LENGTH), delimiter: mailbox.delimiter,
    specialUse: mailbox.specialUse?.slice(0, 100) ?? null, flags: [...(mailbox.flags ?? [])].slice(0, 50).map((flag) => flag.slice(0, 100)) };
}
export async function listMailboxes(accountId: string): Promise<MailboxSummary[]> {
  return safely(() => withImapClient(accountId, async (client) => (await client.list()).slice(0, MAX_MAILBOXES).map(summary)));
}
export async function createMailbox(accountId: string, name: string): Promise<void> {
  validName(name); return safely(() => withImapClient(accountId, async (client) => { await client.mailboxCreate(name); }));
}
export async function renameMailbox(accountId: string, oldName: string, newName: string): Promise<void> {
  validName(oldName); validName(newName); return safely(() => withImapClient(accountId, async (client) => { await client.mailboxRename(oldName, newName); }));
}
export async function deleteMailbox(accountId: string, name: string): Promise<void> {
  validName(name); return safely(() => withImapClient(accountId, async (client) => { await client.mailboxDelete(name); }));
}
export async function findTrashMailbox(client: ImapFlow): Promise<string | null> {
  return (await client.list()).find((mailbox) => mailbox.specialUse?.toLowerCase() === '\\trash')?.path ?? null;
}
